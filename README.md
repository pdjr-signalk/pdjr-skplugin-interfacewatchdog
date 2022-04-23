# pdjr-skplugin-canwatchdog

Watchdog looking for CAN interface lockup

# Background
I started using Signal K in 2018 and would occaionally find that my server
had failed because its N2K input data stream had died.
This problem persisted over multiple generations of server hardware and
software and despite many hours of investigation proved to be an intractable
problem.

My suspicion is that there is a device on my N2K bus which is generating
data that Signal K's CAN interface parser (I currently use canboatjs) cannot
handle, but the sporadic nature of the fault has made diagnosis difficult.

This plugin was written as a diagnostic tool, but until I make the time
to investigate the problem further it serves as a rather crude solution to
the problem of a dead input data stream.
The operating principle is simple: monitor Signal K's  delta data throughput
(in deltas per second) on a specified CAN interface and if the rate falls
below some designated threshold then log the time of failure and (optionally)
restart Signal K (I haven't worked out how to simply reboot canboatjs).

# Configuration
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
