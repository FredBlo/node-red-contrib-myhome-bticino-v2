## 2. Version history
### v2.1.0 (latest available)
- **General**
  - ***Bug fix*** :
  - ***Improvement (technical)*** : the `payload.command_sent` returned from all nodes is now always an array of string, since multiple commands can have been sent when updating a single node (in v2.0.0, it was a string).

  @TODO : update doc of related nodes

- **MH Gateway**
  - ***Bug fix*** :
  - ***Improvement*** :
- **MH Monitoring**

- **MH Inject**
    - ***Improvement*** : the node can now be called with multiple commands (either using a string with command separated by comma, semi-colon or space, either using an array of strings). It will return an error when ALL commands have failed. As soon as at least 1 command was successful, no error is returned.

- **MH Light**

- **MH Shutter**

- **MH Temperature**
  New
  @TODO : document it
