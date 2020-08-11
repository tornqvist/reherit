import { createRequire } from 'module'
import { use, store, watch, Layer, ANY, stack } from './index.js'

const require = createRequire(import.meta.url)
const test = require('tape')

test('API', function (t) {
  t.plan(16)

  t.equal(typeof use, 'function', 'exports use function')
  t.equal(typeof store, 'function', 'exports store function')
  t.equal(typeof watch, 'function', 'exports watch function')
  t.equal(typeof Layer, 'function', 'exports Layer class')
  t.equal(typeof ANY, 'symbol', 'exports ANY symbol')
  t.ok(Array.isArray(stack), 'exports layer stack')

  var value = 1
  var layer = use(function (arg) {
    t.equal(arg, value, 'value was forwarded')
    if (value === 1) {
      t.equal(stack.length, 1, 'stack is populated during resolve')
      t.equal(stack[0], layer, 'stack has layer currently being resolved')
    } else if (value === 2) {
      t.equal(layer.store.one, 1, 'store was assigned')
      t.equal(layer.store.two, 2, 'store was updated')
    } else {
      t.fail()
    }
    return arg
  }, null, value)

  t.ok(layer instanceof Layer, 'exposes layer')

  var res = layer.resolve()
  t.equal(res, value, 'returns result')

  layer.assign({ one: 1 }, [++value])
  layer.update('two', 2)
  layer.subscribe('three', function (value) {
    t.equal(value, 3, 'value forwarded to keyed listener')
  })
  layer.subscribe(ANY, function (value) {
    t.equal(typeof value, 'undefined', 'value not forwarded to unkeyed listener')
  })
  layer.emit('three', 3)
  layer.emit('four', 4, { any: false })
})

test('async components', async function (t) {
  t.plan(1)

  var res = await Promise.all([
    use(async () => 1).resolve(),
    use(function * () {
      var res = yield 2
      return res
    }).resolve(),
    use(function * () {
      var res = yield Promise.resolve(3)
      return res
    }).resolve()
  ])

  t.deepEqual(res, [1, 2, 3], 'all async components resolved')
})

test('store default value', function (t) {
  t.plan(1)
  var layer = use(Main)
  layer.resolve()

  function Main () {
    var [value] = store('value', 'fallback')
    t.equal(value, 'fallback', 'uses fallback value')
  }
})

test('providing a store', function (t) {
  t.plan(1)
  var layer = use(Main, { value: 'hi' })
  layer.resolve()

  function Main () {
    var [value] = store('value')
    t.equal(value, 'hi', 'provided store was used')
  }
})

test('manipulating stores', function (t) {
  t.plan(3)

  var step = 0
  var steps = [1, 2, 3, 4]
  var layer = use(Main)
  var res = layer.resolve()

  t.equal(res, steps[2], 'layer is resolved synchronously')

  function Main () {
    var [value, setValue] = store('value', steps[0])
    var [, setState] = store()
    if (step === 0) {
      setState({ value: steps[++step] })
      t.fail('should interrupt on update mid-render')
    } else if (step === 1) {
      t.equal(value, steps[1], 'can set state')
      setValue(steps[++step])
      t.fail('should interrupt on update mid-render')
    } else if (step === 2) {
      t.equal(value, steps[2], 'can set property by key')
    }
    return value
  }
})

test('top level store is mutated', function (t) {
  t.plan(1)
  var state = {}

  use(Main, state).resolve()
  t.equal(state.value, 'hi', 'state was mutated')

  function Main () {
    store('value', 'hi')
  }
})

test('callback', function (t) {
  t.plan(1)

  var layer = use(Main)

  layer.resolve(function (res) {
    t.equal(res, 2, 'resolve callback called on async update')
  })

  function Main () {
    var [value, setValue] = store('value', 1)
    if (value === 1) setTimeout(() => setValue(2), 100)
    return value
  }
})

test('watching store', function (t) {
  t.plan(9)
  var expected = 0
  var layer = use(Main)
  layer.resolve()

  function Main () {
    var [value, setValue] = store('value', 0)
    watch('value', function (_value) {
      t.equal(_value, expected, `keyed watcher called with new value after ${value ? 'update' : 'render'}`)
      return function () {
        t.pass('keyed cleanup called before update')
      }
    })
    watch(['value'], function (values) {
      t.deepEqual(values, [expected], `array of keys watcher called with new values after ${value ? 'update' : 'render'}`)
      return function () {
        t.pass('array of keys cleanup called before update')
      }
    })
    watch(function () {
      t.equal(arguments.length, 0, `no value passed to unkeyed watcher after ${value ? 'update' : 'render'}`)
      return function () {
        t.pass('unkeyed cleanup called before update')
      }
    })
    if (value === 0) {
      setTimeout(function () {
        setValue(++expected)
      }, 100)
    }
  }
})

test('children', function (t) {
  t.plan(8)
  var children = Array(3).fill().map((_, i) => i)
  var layer = use(Main, { root: 0 })
  var tree = layer.resolve(function (tree) {
    t.deepEqual(tree, {
      root: 1,
      children: [{
        key: 2,
        index: 0,
        local: 2
      }, {
        key: 1,
        index: 1,
        local: 1
      }, {
        key: 0,
        index: 2,
        local: 0
      }]
    }, 'reversed tree maintained stores')
  })

  t.deepEqual(tree, {
    root: 0,
    children: [{
      key: 0,
      index: 0,
      local: 0
    }, {
      key: 1,
      index: 1,
      local: 1
    }, {
      key: 2,
      index: 2,
      local: 2
    }]
  }, 'tree match')

  function Main () {
    var [root, setRoot] = store('root')

    if (root === 0) {
      setTimeout(function () {
        children.reverse()
        setRoot(1)
      }, 100)
    }

    return {
      root,
      children: children.map(function (key, i) {
        const layer = use(child, { key }, i)
        return layer.resolve(function () {
          t.fail('childrens callback should not be called')
        })
      })
    }
  }

  function child (index) {
    var [key] = store('key')
    var [local] = store('local', index)
    watch('root', function (value) {
      if (!value) t.pass('child watcher for parent store called after render')
      else t.pass('child watcher for parent store called after update')
    })
    return { index, key, local }
  }
})
