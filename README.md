# pdjr-skplugin-interfacewatchdog

Interface activity watchdog for Signal K.

## Background

I had a problem on my ship where a buggy N2K device was occasionally
issuing a broken PGN which in-turn caused Signal K's CAN interface
driver (in my case 'canboatjs') to lock-up.

This plugin was designed to automatically restart Signal K when an
interface lock-up was detected and so stop the problem becoming a major
issue until the underlying bugs can be diagnosed and fixed.

The bugs may now have been fixed, but I still run the plugin just in
case...

## Description

**pdjr-skplugin-interfacewatchdog** monitors the activity of one or
more specified Signal K interfaces waiting for the connection rate to
fall below some specified threshold.
If this happens, the plugin writes a message to the server log, issues
a notification, and, optionally, restarts the host Signal K server.

The plugin was designed to monitor interfaces associated with a data
connection, but can be used against any interface listed in the
server dashboard connection panel.

## Configuration

The plugin configuration consist of an "interfaces" array, each item of
which supplies configuration properties for an interface that should be
monitored:

Property         | Description |
:--------------- | :---------- |
interface        | The name of the Signal K interface that should be monitored. |
threshold        | The data rate (in deltas per second) at or below which the plugin should act. |
restart          | Whether or not the plugin should restart the Signal K host when throughput drops below the specified *threshold*. |
notificationpath | This optional property can be used to specify the path under `vessels.self.` on which the plugin should issue alarm notifications. If omitted, then the path "notifications.interfacewatchdog.*interface*" will be used. |

A new installation will have a single array entry:

```
[
  {
    "interface": "n2k-on-ve.can-socket",
    "threshold": 0,
    "restart": true
  }
]
```

Configuration files from earlier, single interface, versions of the
plugin are automatically upgraded.

## Operation

1. The plugin ignores a configured interface until it becomes active.
   This prevents the plugin causing repeated, immediate, restarts on a
   server on which an interface is disconnected or otherwise dead.
   
2. Once activity is detected on a configured interface the plugin
   checks the throughput statistic reported by Signal K each time the
   server issues a 'serverevent' of type 'SERVERSTATISTICS' (typically
   every four or five seconds). You can view these activity values in
   the Signal K dashboard.

3. If the throughput reported by the server is less than or equal to
   the configured interface threshold then an alarm notification is
   issued on the configured notification path and, if restart is
   enabled, the host Node process is killed.
   Otherwise, a normal notification is issued on the specified
   notification path.
   
Note that:

* If restart is not configured then any previously issued alarm
  notification is cleared if throughput again rises above *threshold*.
  
* If and when the Signal K Node process is killed it will only restart
  automatically if the host operating system's process manager is
  configured for this behaviour.

* A kill signal is issued approximately one second after the associated
  alarm notification: this delay is designed to allow an alarm handler
  or annunciator to detect the alarm condition and do its thing.

* The event handler which detects interface throughput cannot update
  plugin status information in the Signal K Dashboard, so the only
  plugin status message displayed on the server dashboard is that
  associated with plugin initialisation.

* Actions taken by the plugin are written to the server log.

## Author

Paul Reeve <preeve_at_pdjr_dot_eu>
