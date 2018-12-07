import microMatch from 'micromatch'
import { map } from 'lodash'

class AuditXoPlugin {
  constructor({ xo }) {
    this._xo = xo
    this._listeners = {
      'xo:preCall': this._logPreCall.bind(this),
      'xo:postCall': this._logPostCall.bind(this),
    }

    xo.getLogger('audit').then(logger => {
      this._logger = logger
    })
  }

  load() {
    this._methodsToNotLog = { __proto__: null }

    // add listeners
    map(this._listeners, (method, event) => this._xo.on(event, method))
  }

  unload() {
    this._methodsToNotLog = undefined

    // remove listeners
    map(this._listeners, (method, event) =>
      this._xo.removeListener(event, method)
    )
  }

  // data: { userId, method, params, callId }
  _logPreCall(data) {
    if (microMatch.some(data.method, this._xo._config.methodsPattern)) {
      this._methodsToNotLog[data.callId] = true
      return
    }

    this._logger.notice(`Audit log (${data.callId})`, {
      event: 'task.start',
      data,
    })
  }

  _logPostCall({ callId: taskId, error, result = error }) {
    if (this._methodsToNotLog[taskId]) {
      delete this._methodsToNotLog[taskId]
      return
    }

    const [status, loggerLevel] =
      error !== undefined ? ['failure', 'error'] : ['success', 'notice']

    this._logger[loggerLevel](`Audit log (${taskId})`, {
      event: 'task.end',
      result,
      status,
      taskId,
    })
  }
}

export default opts => new AuditXoPlugin(opts)
