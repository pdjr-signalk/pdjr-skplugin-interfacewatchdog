# pdjr-skplugin-canwatchdog

Watchdog looking for CAN interface lockup.

## Description
**canwatchdog** monitors the throughput in deltas per second of a
specified Signal K interface.
If the throughput falls below some user defined threshold then a
warning is written to the server log and, if configured, the plugin
will restart the host Signal K server.

The plugin was written as a tool to help diagnose a problem on my
own vessel where a buggy N2K device was occasionally issuing a
broken PGN which in-turn caused Signal K's CAN interface driver
(in my case canboatjs) to lock-up.
Rebooting Signal K on CAN interface lock-up made the problem a
much less annoying issue.

## Configuration
The plugin recognises the following configuration properties.

**CAN interface (string)**
Specifies the CAN interface that should be monitored.
Defaults to "n2k-on-ve.can-socket".

**Trigger threshold (integer >= 0)**
Specifies the deltas/s rate at or below which the plugin should log
an issue and, optionally, reboot the host Signal K instance.
Defaults to 0.

**Reboot? (boolean)**
Specifies whether or not the plugin should reboot the Signal K host
when the CAN interface throughput falls below "Trigger threshold".
Defaults to true.

## Issues
The event handler which detects CAN interface throughput cannot update
the Signal K Dashboard, so operational status is only recorded in the
host system log.

## Author
Paul Reeve <preeve_at_pdjr.eu>
