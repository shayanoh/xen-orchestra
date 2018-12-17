import asyncMap from '@xen-orchestra/async-map'
import microMatch from 'micromatch'
import { forOwn, map } from 'lodash'

const NAMESPACE = 'audit'

class AuditXoPlugin {
  constructor({ xo }) {
    this._xo = xo
    this._removeApiMethods = undefined
    this._runningTasks = new Set()
    this._tasksToNotLog = new Set()
    this._listeners = {
      'xo:preCall': this._logTaskStart.bind(this),
      'xo:postCall': this._logTaskEnd.bind(this),
    }

    xo.getLogger(NAMESPACE).then(logger => {
      this._logger = logger
    })
  }

  load() {
    const xo = this._xo

    this._removeApiMethods = xo.addApiMethods({
      'plugin.audit.getLogs': this._getLogs.bind(this),
      'plugin.audit.clearLogs': this._clearLogs.bind(this),
    })

    // add listeners
    map(this._listeners, (method, event) => xo.on(event, method))
  }

  unload() {
    this._removeApiMethods()
    this._runningTasks.clear()
    this._tasksToNotLog.clear()

    // remove listeners
    map(this._listeners, (method, event) =>
      this._xo.removeListener(event, method)
    )
  }

  // data: { userId, method, params, callId }
  _logTaskStart(data) {
    const { callId, method } = data

    if (microMatch.some(method, this._xo._config.methodsPattern)) {
      this._tasksToNotLog.add(callId)
      return
    }

    this._runningTasks.add(callId)
    this._logger.notice(`Audit log (${callId})`, {
      event: 'task.start',
      data,
    })
  }

  async _logTaskEnd({ callId: taskId, error, result = error }) {
    if (this._tasksToNotLog.has(taskId)) {
      this._tasksToNotLog.delete(taskId)
      return
    }

    const [status, loggerLevel] =
      error !== undefined ? ['failure', 'error'] : ['success', 'notice']

    // waiting for the log of the "task.end" to avoid a race condition with "_clearLogs"
    await this._logger[loggerLevel](
      `Audit log (${taskId})`,
      {
        event: 'task.end',
        result,
        status,
        taskId,
      },
      true
    )
    this._runningTasks.delete(taskId)
  }

  async _getLogs() {
    const logs = {}
    forOwn(await this._xo.getLogs(NAMESPACE), ({ data, time }) => {
      if (data.event === 'task.start') {
        const { callId } = data.data
        logs[callId] = {
          ...data.data,
          start: time,
          status: this._runningTasks.has(callId) ? 'pending' : 'interrupted',
        }
        return
      }

      const log = logs[data.taskId]
      log.result = data.result
      log.status = data.status
      log.end = time
    })
    return logs
  }

  // it only delete the finished/interrupted tasks log
  async _clearLogs() {
    await asyncMap(this._xo.getLogs(NAMESPACE), ({ data }, id) => {
      if (
        data.event !== 'task.start' ||
        !this._runningTasks.has(data.data.callId)
      ) {
        return this._logger.del(id)
      }
    })

    return true
  }
}

export default opts => new AuditXoPlugin(opts)
