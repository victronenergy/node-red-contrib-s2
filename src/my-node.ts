import { NodeAPI } from 'node-red';

module.exports = function(RED: NodeAPI) {
  console.log("Hey, this is my-node. This console.log is from my-node.ts");
  function MyNode(config: any) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', function(msg: any) {
      msg.payload = (msg.payload || '') + ' processed by MyNode';
      node.send(msg);
    });
  }

  RED.nodes.registerType('my-node', MyNode);
}
