# pdjr-skplugin-canwatchdog

Watchdog looking for interface lockup.

## Description

**canwatchdog** monitors the data rate in deltas per second of a
specified Signal K interface.
If the data rate on the selected interface falls below some user
defined threshold then the plugin will at least write a warning
message to the server log and may (with appropriate configuration)
restart the host Signal K server.

The plugin was designed to monitor CAN interfaces, but can be used
against any 'provider' interface.

## Configuration

The plugin recognises the following configuration properties.

**Interface**
: A string value specifying the Signal K interface that should be monitored. Defaults to 'n2k-on-ve.can-socket'.

**Threshold**
: An integer value specifying the data rate in deltas per second at or below which the plugin should act. Defaults to 0.

**Reboot**
: A boolean value specifying whether or not the plugin should reboot the Signal K host when throughput excurses below 'Threshold'. Defaults to true.

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
problem a much less annoying issue until the underlying problem
with 'canboatjs' was fixed.

## Author

Paul Reeve <preeve_at_pdjr.eu>
