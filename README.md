
# Experimental Node-RED Node with TypesScript Support

(tbc)

# Installation

1. Clone this repository to your local machine.
2. `npm install` to install dependencies.
3. Configure Node-RED to use this package, as per [the Node-RED
   documentation](https://nodered.org/docs/creating-nodes/first-node).
4. Restart Node-RED.

# Development

For development, as part of the code requires transpilation from TypeScript to JavaScript,
it is useful to have a build step that runs automatically on file changes. You can do this by running

```bash
npm run dev
```

in a separate terminal window. This will watch for changes in the `src` directory and
transpile the TypeScript files to JavaScript in the `dist` directory.

You still need to restart Node-RED to pick up the changes, though.

