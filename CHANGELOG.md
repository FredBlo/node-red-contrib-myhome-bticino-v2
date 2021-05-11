# node-red-contrib-myhome-bticino-v2
## Version history
### v2.1.0 (latest available) - 05/2021
- **General**
  - ***Improvement (technical)*** : the `payload.command_sent` returned from all nodes is now always an array of strings, since multiple commands can have been sent when updating a single node (in v2.0.0, it was a string).
  - ***Improvement*** : a '***SmartFilter***' was added on all nodes (temperature, light, shutter). The purpose is to have node-RED triggering new flows (aka output) only on a **state CHANGE** after a MyHome BUS message was received.  This is made to avoid multiple flows starting for the same info/command, because MyHome sends the same message multiple times (for status request, response,...)
  Notes:
    - SmartFilter is never applied when node is running in **read-only** (status update request) mode.
    - The SmartFilter is **enabled by default** for new nodes but will remain disabled on your existing nodes until you manually decide to enable it. This way, it also remains **backward compatible** with existing configs.
  - ***Improvement*** : the 'skip events' function was improved on existing nodes (Lights & Shutters) : the incoming BUS messages are still processed by the node (to collect data and update node status) but will still not generate an output (~flow).
  - ***Improvement*** : all nodes also return the commands which failed (i.e. which were refused by the MyHome gateway when sent) in `payload.command_failed`.
- **MH Gateway**
  - ***Bug fix*** : initial connection to gateway will now process correctly all received packets. Before this fix, the gateway sometimes needed 2-3 attemps before being able to connect because it 'missed' some responses.
- **MH Inject**
  - ***Improvement*** : the node can now be called with **multiple commands** (either using a string with commands set one after the other, either using an array of strings). It will return an error when ALL commands have failed. As soon as at least 1 command was successful, no error is returned. When sending multiple commands, a custom **delay** can be defined which is applied between 2 commands (minimum is 50ms)
- **MH Light**
  - ***Bug fix*** : the node will no longer try to send '*status request command*' when configured as a group in Read-Only mode, since groups have no status.
  - ***Improvement*** : when a light point is updated by a node-RED msg (i.e. sent to the MyHome Gateway), the engine now also appends a second command sent to the MyHome Gateway to get the **effective light state** afterwards. This was made to work-around a 'limitation' of MyHome OpenWebNet where no status update message is responded on such posted command. Thanks to this, there is no more difference between a '*requested state*' and the '*effective state*'. This is non applicable to groups (which have no state).
  - ***Improvement*** : brightness can now be used as simplified secondary output.
- **MH Shutter**
  - ***Bug fix*** : the node will no longer try to send '*status request command*' when configured as a group in Read-Only mode, since groups have no status.
  - ***Improvement*** : when a shutter point is updated by a node-RED msg (i.e. sent to the MyHome Gateway), the engine now also appends a second command sent to the MyHome Gateway to get the **effective shutter state** afterwards. This was made to work-around a 'limitation' of MyHome OpenWebNet where no status update message is responded on such posted command. Thanks to this, there is no more difference between a '*requested state*' and the '*effective state*'. This is non applicable to groups (which have no state).
- **MH Temperature Central Unit**
  **New node type**. Added support for temperature control using a 1-99 zones central unit.
  Main included functionalities :
  - node will **read** most zone information
    - current ***mode*** set (auto / manual / off / antifreeze, ...)
    - current ***Weekly program*** set
    - current ***Scenario*** set
    - current ***set-point temperature*** (in manual mode)
    - ***remote control*** enabled status
  - node can be used to **send commands**
    - switch ***modes*** (auto / manual / off / antifreeze, ...)
    - switch to ***manual mode*** and define set-point temperature
    - switch to a ***Weekly program***
    - switch to a ***Scenario***
  See node documentation for full detailed information.
- **MH Temperature Zone**
  **New node type**. Added support for temperature control in defined zones.
  Main included functionalities :
  - node will **read** most zone information
    - master probe ***current temperature***
    - current ***set-point temperature***
    - zone ***operation type*** (heating, conditioning,...)
    - zone ***operation mode*** (automatic, manual, antifreeze,...)
    - zone ***binded actuators***' state info (on, off, opened, closed,...)
  - node can be used to **send commands**
    - switch to ***manual mode*** and define set-point temperature
    - switch ***modes*** (auto / antifreeze / protection mode / ...)
  See node documentation for full detailed information.

### v2.0.1 - 04/2021
Going out of beta phase. Only modification after v2.0.0-beta3 was the addition of the CHANGELOG.md file.

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

#### Beta phase : v2.0.0-beta
First **npm** published release.

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
    - ***Improvement*** : a **secondary output** was added which can be configured within the node to return a `msg.payload` as a simple value or as an object having a configurable property (e.g. `.On`, `.ON`,..) which contains either a  boolean (true/false), as it existed for *'MyHome-Switch'* node before, or a text value (ON / OFF).
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
    - ***Improvement*** : a **secondary output** was added which can be configured within the node to return a `msg.payload` as a simple value or as an object having a configurable property (e.g. `.On`, `.ON`,..) which contains either a  boolean (true/false), as it existed for *'MyHome-Switch'* node before, or a text value (OPEN / CLOSE / STOP).
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