<div align="center">

# Reherit
Reactive state management with prototypal inheritance

</div>

## About
Reherit is a reactive state manager intended to be used with interactive
interfaces made up of many seperate components. Each components state (called
store) is inherited from it's parent using prototypal inheritance.

Stores can be accessed and manipulated by any component in the tree. Whenever a
store is changed, an update is issued and subscribers are notified.

### Features
- **small API:** you'll get by only learning three functions
- **it's tiny:** just over 1kb, you'll barely know it's there
- **no tooling:** no compilation required, works out of the box
- **runs anywhere:** anywhere ES modules are supported, that is

## Usage

```javascript
import { use, store, watch } from 'reherit'

var dog = use(Dog, { name: 'Maja' }).resolve(console.log)

console.log(dog)

dog.pet()

function Dog () {
  var [name] = store('name')
  var [mood, setMood] = store('mood', 'sad')

  watch('mood', function (mood) {
    console.log(`${name} is ${mood}`)
  })

  return { name, mood, pet: () => setMood('happy') }
}
```

Running the above example will print the following to the console:

```bash
-> Maja is sad
-> { name: 'Maja', mood: 'sad' }
-> Maja is happy
-> { name: 'Maja', mood: 'happy' }
```

### Installation
Reherit is distributed as a ES module and can be installed with your favourite package manager, e.g.:

```bash
npm install reherit
```

It can also be imported from unpkg.com

```javascript
import { use, store, watch } from 'https://unpkg.com/reherit/dist/index.js'
```

## API
While resolving a component tree, Reherit builds a "stack" of "layers" which
reflects the inheritance of stores, one layer inherits from the one before it,
and so on. However, there are only three functions you really need to learn to
use Reherit.

### `use(Function, [store, [...args]])`
Creates a [`Layer`](#layer) which can be [`resolved`](#layerresolvefunction)
into the rendered component. Takes a component function as it's first argument
followed by an optional store and arguments. The store (if provided) will be
assigned onto the inherited store. Arguments are forwarded to the component
function. Returns [`Layer`](#layer).

### `store([key, [initialValue]])`
Read from component store, optionally providing an initial value if none is set
already. Returns a touple (fancy word for array with two values) with the value
and a function for updating the value.

If the key being requested is not set to the current component store, it will
walk up the prototype chain looking for it. If found on a parent store, that
value will be returned and the update function will update that parent value.

If the key is not found in the prototype chain, but an initial value is
provided, the initial value will be set to the current component store and the
update function will only update the current component.

If no key is provided, the store object will be returned and the update function
will assign properties directly to the store.

```javascript
var [state, setState] = store()
var [value, setValue] = store('key', 'hello')

setState({ key: 'hi' }) // <- These two have the same effect
setValue('hi')          // <-
```

### `watch(key, [Function])`
Listen for changes to the store. If key is a function the function will be
attached as a listener for any changes to the store. Key can also be an array of
keys to watch. Listeners are called *after* the component has rendered and on
every update to the given key(s).

The listener may return a function which will be called on the next update of
the given key(s) *before* the component is rendered.

```javascript
watch('key', function (value) {
  console.log('value is', value)
  return function (value) {
    console.log('value has been updated to', value)
  }
})
```

### Layer
A layer is the container for a component, holding its store, listeners and
children.

#### `Layer#resolve([Function])`
Call component function, calling any listeners and handling state in the
process. Generators and promises returned/yielded from the component function
are awaited for and resolved.

If provided, the function passed to resolve will be called on subsequent
asynchronous updates.

#### `Layer#assign(store, args)`
Update layer internal store and cached arguments without issuing an update.

#### `Layer#update(key, [value])`
Update the store with given key/value pair. If no value is provided, the key is
assigned onto the store.

#### `Layer#subscribe(key, Function)`
Subscribe to updates made to the layer store.

#### `Layer#emit(key, value)`
Call all subsribers registered for the given key. The value will be passed to
the listeners.

## License
MIT
