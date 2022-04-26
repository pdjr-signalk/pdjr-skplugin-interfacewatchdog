# pdjr-skplugin-interfacewatchdog

Signal K interface activity watchdog.

## Description

**interfacewatchdog** monitors the activity of a specified Signal K interface
waiting for the connection rate to fall below some specified threshold.
If this happens, the plugin writes a message to the server log, issues a
notification and optionally restarts the the host Signal K server.

The plugin was designed to monitor interfaces associated with a data
connection, but can be used against any interface listed in the
server dashboard connection panel.

## Configuration

The plugin recognises the following configuration properties.

Property          | Description | Default value
----------------- | --- | ---
Interface         | The Signal K interface that should be monitored. | 'n2k-on-ve.can-socket'
Threshold         | The data rate (in deltas per second) at or below which the plugin should act. | 0
Restart           | Whether or not the plugin should restart the Signal K host when throughput drops below the specified 'Threshold' value. | true
Notification path | The path under `vessels.self` on which the plugin should issue alarm notifications. | 'notifications.interfacewatchdog'

## Operation

1. The plugin checks throughput on the defined interface each time Signal K
   issues a 'serverevent' of type 'SERVERSTATISTICS' (typically every
   four or five seconds).

2. If the detected throughput is less than or equal to the configured threshold
   then an alarm notification is issued on the specified notification path and,
   if a restart is configured, promptly kill the host process.
   
Note that:

* If restart is not configured then any issued alarm notification is cleared if
  throughput rises above the configured threshold.
  
* If restart is configured Signal K will only restart automatically if the host
  operating system's process manager is configured for this behaviour.

* A restart is delayed for approximately one second after alarm notification.
  This delay allows an annunciator process to detect the alarm and do its thing.

* The event handler which detects interface throughput cannot update plugin
  status information in the Signal K Dashboard, so the only plugin status message
  you will see is confirmation that the plugin has started.

## Background

The plugin was written as a tool to help diagnose a problem on my own
vessel where a suspected buggy N2K device is occasionally issuing a
broken PGN which in-turn causes Signal K's CAN interface driver (in my
case 'canboatjs') to lock-up.

Automatically restarting Signal K when an interface lock-up is detected
stops the problem becoming a major issue until the inferred 'canboatjs'
bug can be diagnosed and fixed.

## Author

Paul Reeve <preeve_at_pdjr_dot_eu>
