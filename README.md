# pdjr-skplugin-interfacewatchdog

Interface activity watchdog for Signal K.

## Background

I had a problem on my ship where a buggy N2K device was occasionally
issuing a broken PGN which in-turn caused Signal K's CAN interface
transceiver to lock-up.

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

## Configuration

The plugin configuration has the following properties.

| Property         | Default     | Description |
| :--------------- | :---------- | :---------- |
| interfaces       | []          | Required array of interface configuration objects. |

Each object in the *interfaces* array has the following properties.

| Property         | Default     | Description |
| :--------------- | :---------- | :---------- |
| interface        | (none)      | Required name of the Signal K interface that should be monitored. |
| threshold        | 0           | Optional integer data rate (in deltas per second) at or below which the plugin should act. |
| restart          | false       | Optional boolean saying whether or not the plugin should restart the Signal K host when throughput on *interface* drops below the specified *threshold*. |
| notificationpath | (see below) | Optional path under `vessels.self.` on which the plugin should issue alarm notifications. |

If *notificationpath* is omitted, then the path "notifications.interfacewatchdog.*interface*" will be used.

## Operation

The plugin ignores a configured interface until it becomes active.
This prevents the plugin causing repeated, immediate, restarts on a
server on which an interface is disconnected or otherwise dead.

Once activity is detected on a configured interface the plugin checks
the throughput statistic reported by Signal K each time the server
issues a 'serverevent' of type 'SERVERSTATISTICS' (typically every four
or five seconds).

If the throughput reported by the server is less than or equal to the
configured interface threshold then an alarm notification is issued on
the configured notification path and, if restart is enabled, the host
Node process is killed.

If the reported interface throughput is above the specified threshold
then a normal notification is issued on the specified notification path.
If restart is not configured then any previously issued alarm
notification will be restored to normal if throughput again rises above
*threshold*.
  
If and when the Signal K Node process is killed it will only restart
automatically if, as is normally the case, Signal K is started by the
host operating system's process manager and it is configured to support
this behaviour.

The restart kill signal is issued approximately one second after the
associated alarm notification: this delay is designed to allow an alarm
handler or annunciator to detect the alarm condition and do its thing.

Actions taken by the plugin are written to the server log.

## Author

Paul Reeve <*preeve_at_pdjr_dot_eu*>
