# pdjr-skplugin-interfacewatchdog

Signal K interface activity watchdog.

## Description

**interfacewatchdog** monitors the activity of a specified Signal K interface
waiting for the connection rate to fall below some specified threshold.
If this happens, the plugin writes a message to the server log, issues a
notification and optionally restarts the host Signal K server.

The plugin was designed to monitor interfaces associated with a data
connection, but can be used against any interface listed in the
server dashboard connection panel.

## Configuration

The plugin recognises the following configuration properties.

Property         | Description | Default value
---------------- | --- | ---
interface        | The Signal K interface that should be monitored. | 'n2k-on-ve.can-socket'
threshold        | The data rate (in deltas per second) at or below which the plugin should act. | 0
restart          | Whether or not the plugin should restart the Signal K host when throughput drops below the specified 'Threshold' value. | true
notificationpath | The path under `vessels.self` on which the plugin should issue alarm notifications. | 'notifications.interfacewatchdog'

## Operation

1. If *interface* appears to be dead on startup then the plugin
   issues a message to the Signal K dashboard ane exits.

2. The plugin checks throughput on *interface* each time Signal K
   issues a 'serverevent' of type 'SERVERSTATISTICS' (typically every
   four or five seconds).

2. If the detected throughput is less than or equal to *threshold*
   then an alarm notification is issued on *notificationpath* and,
   if *restart* is true, promptly kills the host Node process.
   
Note that:

* If *restart* is not true then any previously issued alarm notification
  is cleared if throughput again rises above *threshold*.
  
* If and when the Signal K Node process is killed it will only restart
  automatically if the host operating system's process manager is configured
  for this behaviour.

* The kill signal is issued approximately one second after the alarm is issued
  on *notificationpath*: this delay is designed to allow an alarm handler or
  annunciator to detect the alarm condition and do its thing.

* The event handler which detects interface throughput cannot update plugin
  status information in the Signal K Dashboard, so the only plugin status message
  you will see on the server console is confirmation that the plugin has started.

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
