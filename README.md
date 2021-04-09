# node-red-contrib-myhome-bticino-v2

Control Bticino / Legrand MyHome&#8482; components from Node-RED : node-red-contrib-myhome-bticino-v2 is a Node-RED nodes pack to interact with Bticino / Legrand MyHome&#8482; devices making use of [OpenWebNet](https://en.wikipedia.org/wiki/OpenWebNet) protocol through a supported gateway (see gateway info underneath).

## 1. Available nodes
- **MH Light**
	- ON / OFF
	- Dimming (percentage based)
- **MH Shutter**
	- OPEN / CLOSE /STOP
- **MH Monitoring**
	- Listen for any message on the bus and sends it as payload
- **MH Inject**
	- Sends any message provided in payload to bus. e.g.
  		- **`*1*1*16##`** to turn on light **16**
  		- **`*#1*16##`** to ask for status about light **16**, receiving as a response **`*1*1*16##`** when is ON or **`*1*0*16##`** when is OFF

## 2. Version history
### v2.0.0 (latest available)
This version is a major refactoring of the previous v0.2.2 to improve stability, performance, enable more functionalities and extend support to new gateways (using HMAC secured access)
- **General**
    - ***Bug fix*** : Node-RED server crashed when devices are being scanned/updated. It occurred when a command was sent to the BUS to scan or update devices (i.e. physical ones such as switches, actuators, dimmers,... using MyHome Suite configuration software)
    - ***Bug fix*** : any command sent was de-duplicated and sent twice to the BUS
    - ***Performance improvement*** : the gateway now only triggers the scoped family (i.e. Lights, Shutters, Energy,...) instead of triggering all nodes for every incoming command, requiring the node to perform filtering afterwards by itself
- **MH Gateway** (previously called *'MyHome-Gateway'*)
    - ***Bug fix*** : when the node is unloaded (i.e. on node/flow re-deploy), it is now correctly closed. Without this fix, the gateway was persisting multiple times in memory and was still triggering multiple times the same update on all connected nodes
    - ***Bug fix*** : improved management of (re)connections : before this fix, the gateway could emit a lot of TCP requests / error when the gateway was not responding. Within a few seconds, 100+k request could be sent, causing the Node-RED server to crash and logs to reach unmanageable volumes.
    - ***Bug fix*** : better management of initial connection to gateway. Before this fix, the gateway could fail detecting OpenWebNet 'ACK' commands. This occurred 1 time out of 3-5 (for me on F455), and mostly when the Node-RED server and/or gateway was able to process responses 'too quickly'.
    - ***Improvement*** : secured access (i.e. using a password) was extended to support **HMAC** authentication (SHA-1 and SHA-2), used by latest BTicino gateways (such as myHOMEServer1)
    - ***Improvement*** : gateway can be configured to generate log content (node logs, also included on server's console), per **MyHome family group**. It now allows managing 'Lights', 'Shutters', 'Temperature Management' and 'Energy Management', 'All others'.
    - ***Improvement*** : small UI updates (icons,..)
- **MH Monitoring** (previously called *'MyHome-EventSession'*)
    - ***Bug fix***: when the node is unloaded (i.e. on node/flow re-deploy), it is now correctly closed. Without this fix, the node was persisting multiple times in memory and was triggered multiple times too at each OpenWebNet command received from the MyHome BUS
    - ***Improvement*** : ability to **filter** commands starting flows based on family type (Lights, Shutters, Temperature management, Energy management, Others)
- **MH Inject** (previously called *'MyHome-CommandSession'*)
    - ***Improvement*** : added an **output** on node. When the executed command has an OpenWebNet response (e.g. when asking for a light status), the result(s) are included and can be used to trigger other flows/options.
- **MH Light** (previously called *'MyHome-Light'*)
    - ***Bug fix***: when the node is unloaded (i.e. on node/flow re-deploy), it is now correctly closed. Without this fix, the node was persisting multiple times in memory and was triggered multiple times too at each OpenWebNet command received from the MyHome BUS
    - ***Improvement*** : small UI updates (icons,..)
    - ***Improvement*** : the payload input (`msg.payload`) can now be of multiple types, for an easier / more flexible **integration**
        - an object where `payload.state` is either 'ON' or 'OFF' (string), and `payload.brightness` (integer) for dimmers (20% - 100%)
        - an object where `payload.On` is either 'true or 'false' (boolean), and `payload.brightness` (integer) for dimmers (20% - 100%)
        - a simple string being either 'ON' or 'OFF'
        - a simple boolean being either 'true' or 'false'
    - ***Improvement*** : a **secondary outpout** was added which can be configured within the node to return a `msg.payload` as a simple value or as an object having a configurable property (e.g. `.On`, `.ON`,..) which contains either a  boolean (true/false), as it existed for *'MyHome-Switch'* node before, or a text value (ON / OFF).
    - ***Improvement*** : A light node can be configured as being **'read-only'**. In this mode, no update is sent (i.e. light point is not turned on nor off) but the flow can continue with the responded current light point status.
    - ***Improvement*** : A light node can be configured as being a **group** (allowing sending / monitoring group commands on the MyHome BUS)
    - ***Improvement*** : A light node can be configured to **NOT be triggered** when light commands are received from the BUS (which enables creating nodes only receiving commands from the curent Node-RED flow, not to be launched a second time by a MyHome BUS triggered command)
    - ***Improvement (tech)*** : the first output of the node adds **new values** to the returned payload object :
      - `payload.command_sent` : when the node was triggered from Node-RED (i.e. a command was sent to the MyHome gateway), contains the command which was sent in OpenWebNet protocol (ex: `*1*1*15##` to turn on load 1.5)
      - `payload.command_received` : when the node was triggered from the gateway (i.e. a command was detected on the MyHome BUS for the configured load), contains the command which was read in OpenWebNet protocol (ex: `*1*5*25##` means load 2.5 was turned on at 50% brightness)
      - `payload.command_responses` : when the node was triggered from Node-RED in read-only mode, will contain the returned response from the MyHome BUS in OpenWebNet protocol

### v0.2.2
Thanks to Fabio Bui for his inspiring [work](https://github.com/fabiobui/node-red-contrib-myhome-bticino) on Ralph Vigne's work which lead to:
- Added support for secured gateways (using basic OPEN password, usually set to `12345`)
- Added a secondary output node for switches ('payload.On' being a boolean to easily integrate with homekit-bridge node)

### v0.2.1
Initial (unpublished into NPM repository, but it's on [GitHub](https://github.com/vigne/node-red-bticino-myhome)) version of Ralph Vigne

## 3. Installation & Usage
### 3.1 Previous version user ? Important to read before you decide to upgrade
If you currently use the [node-red-contrib-myhome-bticino](https://flows.nodered.org/node/node-red-contrib-myhome-bticino) and want to upgrade, read this first :  
- **Switches** : These were removed because, technically, they are the same as **Lights** on the MyHome system.
- **Covers** : This type has be renamed to **Shutters**, and also offer new functionalities.

Therefore, for these 2 node types, do not forget to copy information before uninstalling the other version. After installing this one all these nodes will not be available and you will have to re-create them manually with similar configuration.

### 3.2 Install
- Easy approach when **Node-RED is installed**
	If you have Node-RED already installed the recommended install method is to use the editor. To do this, select `Manage Pallette` from the Node-RED menu (top right), and then select `install` tab in the pallette. Search for and install this node (`node-red-contrib-myhome-bticino-v2`).

- Using **NPM**
	If you have not yet installed Node-RED then run following command or go to [Node-RED Installation Guide](https://nodered.org/docs/getting-started/installation).

        npm install -g --unsafe-perm node-red

    Next, to install node-red-contrib-myhome-biticino node run the following command in your Node-RED user directory - typically `~/.node-red`

        npm install node-red-contrib-myhome-bticino-v2

### 3.3 Usage
#### 3.3.1 First touch
In order to easy starting to test the nodes copy this flow in Node-RED selecting **Import** in the menu.

```
[{"id":"ab97f24d.b82ae","type":"inject","z":"e389524d.5c9b","name":"","topic":"cmd/switch","payload":"ON","payloadType":"str","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":180,"y":100,"wires":[["eb9f8904.d99788"]]},{"id":"c26ad40e.e21b48","type":"inject","z":"e389524d.5c9b","name":"","topic":"cmd/switch","payload":"OFF","payloadType":"str","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":180,"y":140,"wires":[["eb9f8904.d99788"]]},{"id":"eb9f8904.d99788","type":"myhome-switch","z":"e389524d.5c9b","switchid":"16","topic":"switch","gateway":"85cc3f4e.d14b8","name":"LightTest","x":400,"y":120,"wires":[["548fd2fb.a0a68c"],[]]},{"id":"548fd2fb.a0a68c","type":"debug","z":"e389524d.5c9b","name":"","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"false","x":630,"y":80,"wires":[]},{"id":"85cc3f4e.d14b8","type":"myhome-gateway","z":"","name":"MH201","host":"192.168.1.44","port":"20000","pass":"12345","timeout":"60"}]
```
After that you have to change the **IP address in the Gateway** configuration and of course the light number in switch node.

#### 3.3.2 Usage of a Light node
Add a **Light node** on your flow and set the light number (`A=1 PL=5` becomes `15`, also be aware the format is 4 digits when A>9 or PL>9, e.g. `A=11 PL=5` becomes `1105`, `A=1 PL=15` becomes `0115`) within its configuration. Configure your Gateway if not configured yet.
Test the Light injecting payload boolean message `true` (or `false`) and setting `Topic` property as `cmd/`**`topic`** where topic is the Switch Topic.

#### 3.3.3 Tips : How to discover device
 1. Add a `MH Monitoring` node on your flow and connect a `Debug Node` to it
 2. Deploy the project and open `Debug messages window`
 3. Turn on the light *(physically I mean :-) )* you want to find the MyHome light/shutter number
 4. Watch the debug window to see the message generated to discover the MyHome light/shutter number  

> Remember that, for lights, the message will be as **`*1*1*xx##`** if on or **`*1*0*xx##`** if off, where **xx** is the number (A/PL) you are trying to discover

## 4. Bticino Gateway & OpenWebNet
BTicino is using a proprietary protocol (SCS) to communicate from/to the devices in MyHome network system. There are a many gateways able to convert SCS protocol to OpenWebNet protocol that is well documented (follow this [link](https://developer.legrand.com/documentation/open-web-net-for-myhome/) for more details) and quite easy to use.
Based on previous authors comments and my own experience when testing/extending these nodes, these are the gateways it supports :
- ***MH201*** : works OK (based on Fabio Bui feedback).
- ***MH202*** (scenario manager - FW 1.0.24) : works OK (tested modes: basic authentication)
- ***F455*** (basic gateway - FW 1.1.2) works OK, best when 'keep alive' is enabled every 10 minutes (tested modes: allowed IP range (no password), basic authentication and advanced authentication (HMAC [SHA-1]))
- ***F459*** (driver manager - FW 2.0.48) : works OK (tested modes: allowed IP range (no password), basic authentication and advanced authentication (HMAC [SHA-2]))
- ***myHOMEServer1*** (FW 2.32.15) : works OK (tested mode: HMAC [SHA-2] authentication -which is the only mode this gateway supports-)

## 5. Contact me
If you have questions, remarks, issues,... please add your input using GitHub for this project (either [issues](https://github.com/FredBlo/node-red-contrib-myhome-bticino-v2/issues) or [discussions](https://github.com/FredBlo/node-red-contrib-myhome-bticino-v2/discussions))
