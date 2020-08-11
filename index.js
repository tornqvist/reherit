const ROOT = Symbol('root')
const UPDATE = Symbol('update')
const CANCEL = Symbol('cancel')
const INTERRUPT = Symbol('interrupt')

/** Pool of used children per parent */
const pool = new WeakMap()

/** Use with {@link Layer#subscribe} to listen for any store changes */
export const ANY = Symbol('any')

/** Current stack of layers being resolved */
export const stack = []

/**
 * Read from store. Returns value
 * @param {any} [key] Store key name, omitting key yields store object
 * @param {any} [initial] Initial value if not found in store
 * @returns {Array} A touple of current value and an update function
 */
export function store (key, initial) {
  console.assert(stack.length, 'store used outside render cycle')

  var layer = stack[0]
  if (!key) return [layer.store, (next) => layer.update(next)]
  if (typeof key === 'string' && key[0] === '$') {
    const _key = key.substring(1)
    let value
    if (hasOwnProperty(layer.store[_key])) {
      value = layer.store[_key]
    } else if (typeof initial !== 'undefined') {
      value = layer.store[_key] = initial
      layer.changes.add(_key)
    }
    return [value, (next) => layer.update(key, next)]
  }
  var value = layer.store[key]
  if (typeof value === 'undefined' && typeof initial !== 'undefined') {
    value = layer.store[key] = initial
    layer.changes.add(key)
  }
  return [value, (next) => layer.update(key, next)]
}

/**
 * Watch store for changes
 * @param {any} key store key to watch or function to call on any change
 * @param {Function} [fn] Function ot call when value of key change
 * @returns {void}
 */
export function watch (key, fn) {
  console.assert(stack.length, 'watch used outside render cycle')

  if (Array.isArray(key)) {
    return key.forEach((_key) => watch(_key, function () {
      var layer = stack[0]
      return fn(key.map((__key) => layer.store[__key]))
    }))
  } else if (typeof key === 'function') {
    fn = key
    key = ANY
  }
  if (key === ANY) {
    stack.forEach((layer) => layer.subscribe(key, fn))
  } else {
    const layer = stack.find((layer) => hasOwnProperty(layer.store, key))
    if (layer) {
      layer.subscribe(key, fn)
      if (layer.fresh) layer.changes.add(key)
    }
  }
}

/**
 * Creates a layer for a component
 * @param {Function} fn Component render Function
 * @param {Object} store Store to use for component
 * @param {...any} args Arguments to forward to component
 * @returns {Layer}
 */
export function use (fn, store, ...args) {
  var layer = stack[0]
  if (store == null) store = {}
  if (!layer) return new Layer(ROOT, fn, store, args)
  if (!layer.children.has(fn)) layer.children.set(fn, new Set())
  if (!pool.get(layer).has(fn)) pool.get(layer).set(fn, new Set())

  var child
  var children = layer.children.get(fn)
  var candidates = pool.get(layer).get(fn)
  var key = typeof store.key === 'undefined' ? children.size + 1 : store.key

  for (const candidate of candidates) {
    if (candidate.key === key) {
      child = candidate
      child.assign(store, args)
      break
    }
  }

  if (!child) {
    store = Object.assign(Object.create(layer.store), store)
    child = new Layer(key, fn, store, args)
  }

  children.add(child)
  return child
}

export class Layer {
  /**
   * Create a layer
   * @param {any} key Unique identifier for component
   * @param {Function} fn Component render Function
   * @param {Object} store Store to use for Component
   * @param {Array} args Arguments to forward to component
   */
  constructor (key, fn, store, args) {
    this.key = key
    this.args = args
    this.store = store
    this.render = render
    this.fresh = true
    this.stack = [...stack]
    this.changes = new Set()
    this.children = new Map()
    this.listeners = new Map()
    pool.set(this, new WeakMap())

    var queued = false
    var running = false

    /**
     * Call component render function, recursively rerunning on every update
     * @returns {any}
     */
    function render () {
      if (running) {
        queued = true
      } else {
        try {
          queued = false
          running = true
          var res = unwind(fn(...this.args))
        } catch (err) {
          if (err === INTERRUPT) {
            queued = true
          } else if (err === CANCEL) {
            var cancel = true
          } else {
            throw err
          }
        } finally {
          running = false
        }

        if (cancel) return
        if (queued) res = this.render()
        return res
      }
    }
  }

  /**
   * Make updates to layer internals on reuse
   * @param {Object} store Properties with which to extend store
   * @param {Array} args Arguments to forward to component
   * @returns {void}
   */
  assign (store, args) {
    this.args = args
    Object.assign(this.store, store)
  }

  /**
   * Resolve component
   * @param {Function} callback Function to call on async updates
   * @returns {any}
   */
  resolve (callback) {
    if (!stack.includes(this)) {
      stack.unshift(this)
    }

    if (typeof callback === 'function') {
      this.subscribe(UPDATE, function onupdate (res) {
        callback(res)
        return onupdate
      })
    }

    try {
      for (const key of this.changes) {
        this.emit(key, this.store[key])
      }

      const res = this.render()

      for (const key of this.changes) {
        this.emit(key, this.store[key])
      }

      return res
    } finally {
      const pooled = pool.get(this)
      for (const [fn, children] of this.children) {
        pooled.set(fn, new Set(children))
      }
      this.fresh = false
      this.children.clear()
      this.changes.clear()
      stack.shift()
    }
  }

  /**
   * Update store, issuing an async render
   * @param {any} key Key of the value to update or a new store to assign
   * @param {any} [value] New value to assign for key
   * @returns {void}
   */
  update (key, value) {
    if (typeof value === 'undefined') {
      Object.assign(this.store, key)
      key = ANY
    } else if (typeof key === 'string' && key[0] === '$') {
      key = key.substring(1)
      this.store[key] = value
    } else {
      if (hasOwnProperty(this.store, key)) {
        this.store[key] = value
      } else {
        const parent = this.stack.find(function (parent) {
          return hasOwnProperty(parent.store, key)
        })
        if (!parent) {
          this.store[key] = value
        } else {
          parent.changes.add(key)
          parent.emit(UPDATE, parent.resolve(), { any: false })
          if (stack.includes(this)) throw CANCEL
          return
        }
      }
    }

    this.changes.add(key)
    if (stack.includes(this)) throw INTERRUPT
    this.emit(UPDATE, this.resolve(), { any: false })
  }

  /**
   * Subscribe to changes made to store. The listener function may return
   * a callback function which will be called on next change, before render.
   * @param {any} key Key to subscribe to
   * @param {Function} fn Function to call on change
   * @returns {void}
   */
  subscribe (key, fn) {
    if (!this.listeners.has(fn)) {
      this.listeners.set(fn, new Set())
    }
    this.listeners.get(fn).add(key)
  }

  /**
   * Emit change
   * @param {any} key Emit an event to subscribed listeners
   * @param {any} value New value for subscribed key
   * @param {Object} [opts] Configure behavior
   * @param {boolean} [opts.any=true] Trigger listerns for {@link ANY}
   */
  emit (key, value, opts = {}) {
    var { any = true } = opts
    var listeners = []
    for (const [fn, keys] of this.listeners.entries()) {
      if (!keys.has(key) && (!any || !keys.has(ANY))) continue
      const cleanup = keys.has(key) && key !== ANY ? fn(value) : fn()
      this.listeners.delete(fn)
      if (typeof cleanup === 'function') listeners.push(cleanup)
    }

    for (const listener of listeners) {
      this.subscribe(key, listener)
    }
  }
}

/**
 * Resolve nested generator and promises
 * @param {any} obj
 * @param {any} [value]
 * @returns {any}
 */
function unwind (obj, value) {
  if (isGenerator(obj)) {
    const res = obj.next(value)
    if (res.done) return res.value
    if (isPromise(res.value)) {
      return res.value.then(unwind).then((val) => unwind(obj, val))
    }
    return unwind(obj, res.value)
  } else if (isPromise(obj)) {
    return obj.then(unwind)
  }
  return obj
}

/**
 * Determin if object is promise
 * @param {any} obj
 * @returns {boolean}
 */
function isPromise (obj) {
  return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function'
}

/**
 * Determine if object is generator
 * @param {any} obj
 * @return {boolean}
 */
function isGenerator (obj) {
  return obj && typeof obj.next === 'function' && typeof obj.throw === 'function'
}

/**
 * Check if object has key set on self
 * @param {Object} obj The object to check
 * @param {any} key The key to look for
 */
function hasOwnProperty (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}
