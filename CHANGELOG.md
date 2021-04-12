# node-red-contrib-myhome-bticino-v2
## Version history
### v2.0.0 (latest available)
First **npm** published release.

#### Beta phase : v2.0.0-beta3
- ***Bug fix*** : Execute command sometimes returned partial results only (detected on very 'loaded' flows, running on F455 gateway)
- ***Improvement (technical)*** : Added more verbose log info when sending commands to MyHome gateway in debug mode
- ***Documentation*** : Updated & finalized README.md :
  - added references to issues published on GitHub linked to [node-red-contrib-myhome-bticino](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues)

#### Beta phase : v2.0.0-beta2
- ***Documentation*** : Updated README.md :
  - shutters info
  - upgrade procedure
  - sample to paste on new install
- ***Improvement (technical)*** : updated *'package.json'* for correct npm publishing (& added automated publishing process from GitHub to npm)

#### v2.0.0 (first launched as v2.0.0-beta)
This version is a major refactoring of the previous [v0.2.2 from Fabio Bui (node-red-contrib-myhome-bticino)](https://github.com/fabiobui/node-red-contrib-myhome-bticino)  to improve stability, performance, enable more functionalities and extend support to new gateways (using HMAC secured access)
- **General**
    - ***Bug fix*** : Node-RED server crashed when devices are being scanned/updated. It occurred when a command was sent to the BUS to scan or update devices (i.e. physical ones such as switches, actuators, dimmers,... using MyHome Suite configuration software). This was reported as a [issue #6 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/6).
    - ***Bug fix*** : any command sent was de-duplicated and sent twice to the BUS. This was reported as a [issue #5 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/5).
    - ***Performance improvement*** : the gateway now only triggers the scoped family (i.e. Lights, Shutters, Energy,...) instead of triggering all nodes for every incoming command, requiring the node to perform filtering afterwards by itself
- **MH Gateway** (previously called *'MyHome-Gateway'*)
    - ***Bug fix*** : when the node is unloaded (i.e. on node/flow re-deploy), it is now correctly closed. Without this fix, the gateway was persisting multiple times in memory and was still triggering multiple times the same update on all connected nodes. This was reported as a [issue #11 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/11).
    - ***Bug fix*** : improved management of (re)connections : before this fix, the gateway could emit a lot of TCP requests / error when the gateway was not responding. Within a few seconds, 100+k request could be sent, causing the Node-RED server to crash and logs to reach unmanageable volumes. This was reported as a [issue #1 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/1).
    - ***Bug fix*** : better management of initial connection to gateway. Before this fix, the gateway could fail detecting OpenWebNet 'ACK' commands. This occurred 1 time out of 3-5 (for me on F455), and mostly when the Node-RED server and/or gateway was able to process responses 'too quickly'. This was reported as a [issue #12 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/12).
    - ***Improvement*** : secured access (i.e. using a password) was extended to support **HMAC** authentication (SHA-1 and SHA-2), used by latest BTicino gateways (such as myHOMEServer1)
    - ***Improvement*** : gateway can be configured to generate log content (node logs, also included on server's console), per **MyHome family group**. It now allows managing 'Lights', 'Shutters', 'Temperature Management' and 'Energy Management', 'All others'.
    - ***Improvement*** : small UI updates (icons,..)
- **MH Monitoring** (previously called *'MyHome-EventSession'*)
    - ***Bug fix***: when the node is unloaded (i.e. on node/flow re-deploy), it is now correctly closed. Without this fix, the node was persisting multiple times in memory and was triggered multiple times too at each OpenWebNet command received from the MyHome BUS. This was reported as a [issue #11 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/11).
    - ***Improvement*** : ability to **filter** commands starting flows based on family type (Lights, Shutters, Temperature management, Energy management, Others)
- **MH Inject** (previously called *'MyHome-CommandSession'*)
    - ***Improvement*** : added an **output** on node. When the executed command has an OpenWebNet response (e.g. when asking for a light status), the result(s) are included and can be used to trigger other flows/options.
- **MH Light** (previously called *'MyHome-Light'*)
    - ***Bug fix***: when the node is unloaded (i.e. on node/flow re-deploy), it is now correctly closed. Without this fix, the node was persisting multiple times in memory and was triggered multiple times too at each OpenWebNet command received from the MyHome BUS. This was reported as a [issue #11 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/11).
    - ***Improvement*** : small UI updates (icons,..)
    - ***Improvement*** : the payload input (`msg.payload`) can now be of multiple types, for an easier / more flexible **integration**
        - an object where `payload.state` is either 'ON' or 'OFF' (string), and `payload.brightness` (integer) for dimmers (20% - 100%)
        - an object where `payload.On` is either 'true' or 'false' (boolean), and `payload.brightness` (integer) for dimmers (20% - 100%)
        - a simple string being either 'ON' or 'OFF' (string)
        - a simple boolean being either 'true' or 'false' (boolean)
    - ***Improvement*** : a **secondary outpout** was added which can be configured within the node to return a `msg.payload` as a simple value or as an object having a configurable property (e.g. `.On`, `.ON`,..) which contains either a  boolean (true/false), as it existed for *'MyHome-Switch'* node before, or a text value (ON / OFF).
    - ***Improvement*** : A light node can be configured as being **'read-only'**. In this mode, no update is sent (i.e. light point is not turned on nor off) but the flow can continue with the responded current light point status.
    - ***Improvement*** : A light node can be configured as being a **group** (allowing sending / monitoring group commands on the MyHome BUS). This was reported as an [improvement request #3 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/3).
    - ***Improvement*** : A light node can be configured to **NOT be triggered** when light commands are received from the BUS (which enables creating nodes only receiving commands from the curent Node-RED flow, not to be launched a second time by a MyHome BUS triggered command)
    - ***Improvement (tech)*** : the first output of the node adds **new values** to the returned payload object :
      - `payload.command_sent` : when the node was triggered from Node-RED (i.e. a command was sent to the MyHome gateway), contains the command which was sent in OpenWebNet protocol (ex: `*1*1*15##` to turn on load 1.5)
      - `payload.command_received` : when the node was triggered from the gateway (i.e. a command was detected on the MyHome BUS for the configured load), contains the command which was read in OpenWebNet protocol (ex: `*1*5*25##` means load 2.5 was turned on at 50% brightness)
      - `payload.command_responses` : when the node was triggered from Node-RED in read-only mode, will contain the returned response from the MyHome BUS in OpenWebNet protocol
- **MH Shutter** (previously called *'MyHome-Cover'*)
    - ***Bug fix***: when the node is unloaded (i.e. on node/flow re-deploy), it is now correctly closed. Without this fix, the node was persisting multiple times in memory and was triggered multiple times too at each OpenWebNet command received from the MyHome BUS. This was reported as a [issue #11 on node-red-contrib-myhome-bticino (v0.2.2)](https://github.com/fabiobui/node-red-contrib-myhome-bticino/issues/11).
    - ***Improvement*** : small UI updates (icons,..)
    - ***Improvement*** : the payload input (`msg.payload`) can now be of multiple types, for an easier / more flexible **integration**
        - an object where `payload.state` is either 'OPEN', 'CLOSE' or 'STOP' (string)
        - an object where `payload.On` is either 'true' (for OPEN) or 'false' (for CLOSE) (boolean)
        - a simple string being either 'OPEN', 'CLOSE' or 'STOP' (string)
        - a simple boolean being either 'true' or 'false' (boolean)
    - ***Improvement*** : a **secondary outpout** was added which can be configured within the node to return a `msg.payload` as a simple value or as an object having a configurable property (e.g. `.On`, `.ON`,..) which contains either a  boolean (true/false), as it existed for *'MyHome-Switch'* node before, or a text value (OPEN / CLOSE / STOP).
    - ***Improvement*** : A shutter node can be configured as being **'read-only'**. In this mode, no update is sent (i.e. shutter is not opened/closed) but the flow can continue with the responded current shutter status.
    - ***Improvement*** : A shutter node can be configured as being a **group** (allowing sending / monitoring group commands on the MyHome BUS).
    - ***Improvement*** : A shutter node can be configured to **NOT be triggered** when shutter commands are received from the BUS (which enables creating nodes only receiving commands from the curent Node-RED flow, not to be launched a second time by a MyHome BUS triggered command)
    - ***Improvement (tech)*** : the first output of the node adds **new values** to the returned payload object :
      - `payload.command_sent` : when the node was triggered from Node-RED (i.e. a command was sent to the MyHome gateway), contains the command which was sent in OpenWebNet protocol (ex: `*2*1*15##` to open shutter 1.5)
      - `payload.command_received` : when the node was triggered from the gateway (i.e. a command was detected on the MyHome BUS for the configured load), contains the command which was read in OpenWebNet protocol (ex: `*1*0*25##` means shutter 2.5 was stopped)
      - `payload.command_responses` : when the node was triggered from Node-RED in read-only mode, will contain the returned response from the MyHome BUS in OpenWebNet protocol

### v0.2.2
Thanks to Fabio Bui for his inspiring [work](https://github.com/fabiobui/node-red-contrib-myhome-bticino) on Ralph Vigne's work which lead to:
- Added support for secured gateways (using basic OPEN password, usually set to `12345`)
- Added a secondary output node for switches ('payload.On' being a boolean to easily integrate with homekit-bridge node)

### v0.2.1
Initial (unpublished into NPM repository, but it's on [GitHub](https://github.com/vigne/node-red-bticino-myhome)) version of Ralph Vigne
