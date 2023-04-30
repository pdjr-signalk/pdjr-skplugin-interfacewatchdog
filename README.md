# pdjr-skplugin-interfacewatchdog

Interface activity watchdog for Signal K.

## Background

I had a problem on my ship where a buggy N2K device was occasionally
issuing a broken PGN which in-turn caused Signal K's CAN interface driver
(in my case 'canboatjs') to lock-up.

This plugin was designed to automatically restart Signal K when an
interface lock-up was detected and so stop the problem becoming a major
issue until the underlying bugs can be diagnosed and fixed.

The bugs may now have been fixed, but I still run the plugin just in
case...

## Description

**pdjr-skplugin-interfacewatchdog** monitors the activity of a
specified Signal K interface waiting for the connection rate to fall
below some specified threshold.
If this happens, the plugin writes a message to the server log, issues a
notification, and, optionally, restarts the host Signal K server.

The plugin was designed to monitor interfaces associated with a data
connection, but can be used against any interface listed in the
server dashboard connection panel.

## Configuration

The plugin recognises the following configuration properties.

Property         | Description | Default
:--------------- | :---------- | ---
interface        | The Signal K interface that should be monitored. | 'n2k-on-ve.can-socket'
threshold        | The data rate (in deltas per second) at or below which the plugin should act. | 0
restart          | Whether or not the plugin should restart the Signal K host when throughput drops below the specified 'Threshold' value. | true
notificationpath | The path under `vessels.self` on which the plugin should issue alarm notifications. | 'notifications.interfacewatchdog'

## Operation

1. The plugin remains idle until throughput appears on *interface*. This
   prevents the plugin causing repeated, immediate, restarts on a server
   on which *interface* is disconnected or otherwise dead.
   
2. Once activity is detected on *interface* the plugin checks the
   throughput statistic reported by Signal K each time the server issues
   a 'serverevent' of type 'SERVERSTATISTICS' (typically every four or
   five seconds). You can view these activity values in the Signal K
   dashboard.

3. If the detected throughput is less than or equal to *threshold*
   then an alarm notification is issued on *notificationpath* and,
   if *restart* is true, the host Node process is killed.
   Otherwise, a normal notification is issued on *notificationpath*.
   
Note that:

* If *restart* is not true then any previously issued alarm notification
  is cleared if throughput again rises above *threshold*.
  
* If and when the Signal K Node process is killed it will only restart
  automatically if the host operating system's process manager is configured
  for this behaviour.

* The kill signal is issued approximately one second after the alarm
  notification is issued on *notificationpath*: this delay is designed to
  allow an alarm handler or annunciator to detect the alarm condition and
  do its thing.

* The event handler which detects interface throughput cannot update plugin
  status information in the Signal K Dashboard, so the only plugin status
  messages you will see on the server dashboard are those associated with
  plugin initialisation.

## Author

Paul Reeve <preeve_at_pdjr_dot_eu>
