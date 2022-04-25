# pdjr-skplugin-canwatchdog

Signal K interface activity watchdog.

## Description

**canwatchdog** monitors the activity of a specified Signal K interface
waiting for the connection rate to fall below some specified threshold.
If this happens, the plugin writes a message to the server log and,
optionally, restarts the the host Signal K server.

The plugin was designed to monitor interfaces associated with a data
connection, but can be used against any interface listed in the
server dashboard connection panel.

## Configuration

The plugin recognises the following configuration properties.

Property  | Description | Default value
--------- | --- | ---
Interface | The Signal K interface that should be monitored. | 'n2k-on-ve.can-socket'
Threshold | The data rate (in deltas per second) at or below which the plugin should act. | 0
Reboot    | Whether or not the plugin should reboot the Signal K host when throughput drops below 'Threshold'. | true

## Issues

The event handler which detects CAN interface throughput cannot update
the Signal K Dashboard, so operational status is only recorded in the
host system log.

Reboot is effected by killing the host process. Signal K will only
restart automatically if the host operating system's process manager
is configured for this behaviour.

## Background

The plugin was written as a tool to help diagnose a problem on my
own vessel where a buggy N2K device was occasionally issuing a
broken PGN which in-turn caused Signal K's CAN interface driver
(in my case 'canboatjs') to lock-up.

Rebooting Signal K when an interface lock-up was detected made the
problem a much less annoying issue until the underlying 'canboatjs'
bug could be diagnosed and fixed.

## Author

Paul Reeve <preeve_at_pdjr.eu>
