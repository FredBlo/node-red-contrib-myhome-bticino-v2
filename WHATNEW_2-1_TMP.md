## 2. Version history
### v2.1.0 (latest available)
- **General**
  - ***Bug fix*** :
  - ***Improvement (technical)*** : the `payload.command_sent` returned from all nodes is now always an array of strings, since multiple commands can have been sent when updating a single node (in v2.0.0, it was a string).
  - ***Improvement*** : a '***SmartFilter***' was added on all nodes (temperature, light, shutter). The purpose is to have node-RED triggering new flows (aka output) only on a **state CHANGE** after a MyHome BUS message was received.  This is made to avoid multiple flows starting for the same info/command, because MyHome sends the same message multiple times (for status request, response,...)
  \
  Notes:
    - SmartFilter is never applied when node is running in **read-only** (status update request) mode.
    - The SmartFilter is **enabled by default** for new nodes but will remain disabled on your existing nodes until you manually decide to enable it. This way, it also remains **backward compatible** with existing configs.
  - ***Improvement*** : the 'skip events' fonction was improved on existing nodes (Lights & Shutters) : the incoming bus messages are still processed by the node (to collect data and update node status) but will still not generate an output (~flow).


- **MH Gateway**
  - ***Bug fix*** :
  - ***Improvement*** :


- **MH Monitoring**


- **MH Inject**
    - ***Improvement*** : the node can now be called with **multiple commands** (either using a string with commands set one after the other, either using an array of strings). It will return an error when ALL commands have failed. As soon as at least 1 command was successful, no error is returned.
    - ***Improvement*** : when sending multiple commands, a custom delay can be defined which is applied between 2 commands (minimum is 50ms)


- **MH Light**
  - ***Bug fix*** : the node will no longer try to send '*status request command*' when configured as a group in Read-Only mode, since groups have no status.
  - ***Improvement*** : when a light point is updated by a node-RED msg (i.e. sent to the MyHome Gateway), the engine now also appends a second command sent to the MyHome Gateway to get the **effective light state** afterwards. This was made to work-around a 'limitation' of MyHome OpenWebNet where no status update message is responded on such posted command. Thanks to this, there is no more difference between a '*requested state*' and the '*effective state*'. This is non applicable to groups (which have no state).
  - ***Improvement*** : brightness can now be used as simplified secondary output.


- **MH Shutter**
  - ***Bug fix*** : the node will no longer try to send '*status request command*' when configured as a group in Read-Only mode, since groups have no status.
  - ***Improvement*** : when a shutter point is updated by a node-RED msg (i.e. sent to the MyHome Gateway), the engine now also appends a second command sent to the MyHome Gateway to get the **effective shutter state** afterwards. This was made to work-around a 'limitation' of MyHome OpenWebNet where no status update message is responded on such posted command. Thanks to this, there is no more difference between a '*requested state*' and the '*effective state*'. This is non applicable to groups (which have no state).


- **MH Temperature Zone**
  \
  **New node type**. Added support for temperature control in defined zones.
  \
  Main included functionalities :
  - node will **read** most zone information
    - master probe ***current temperature***
    - current ***set-point temperature***
    - zone ***operation type*** (heating, conditioning,...)
    - zone ***operation mode*** (automatic, manual, antifreeze,...)
    - ***binded actuators***' state info (on, off, opened, closed,...)
  - node can be used to **push information**
    - switch to ***manual mode*** and define set-point temperature
    - switch ***modes*** (auto / antifreeze / protection mode)
  See node documentation for full detailed information.
