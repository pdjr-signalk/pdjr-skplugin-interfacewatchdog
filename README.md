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
Reboot            | Whether or not the plugin should reboot the Signal K host when throughput drops below the specified 'Threshold' value. | true
Notification path | The path on which the plugin should issue alarm notifications. | 'notifications.interfacewatchdog'

## Operation

1. The plugin checks throughput on *Interface* each time Signal K
   issues a 'serverevent' of type 'SERVERSTATISTICS' (typically every
   four or five seconds).

2. The plugin issues an alarm notification  on *Notification path* if
   throughput on *Interface* falls below *Threshold*. The alarm notification
   is cancelled as soon as throughput is above *Threshold*.

3. If *Reboot* is configured then the plugin will promptly kill
   the host process when *Interface* throughput falls below *Threshold*.
   Signal K will only restart automatically if the host operating system's
   process manager is configured for this behaviour.

4. Any reboot is delayed for approximately one second after alarm
   notification. This delay allows an annunciator process to detect the
   alarm and do its thing.

The event handler which detects CAN interface throughput cannot update plugin
status information in the Signal K Dashboard, so the only plugin status message
you will see is confirmation of startup.

## Background

The plugin was written as a tool to help diagnose a problem on my
own vessel where a buggy N2K device was occasionally issuing a
broken PGN which in-turn caused Signal K's CAN interface driver
(in my case 'canboatjs') to lock-up.

Rebooting Signal K when an interface lock-up was detected made the
problem a much less annoying issue until the underlying 'canboatjs'
bug could be diagnosed and fixed.

## Author

Paul Reeve <preeve_at_pdjr_dot_eu>
