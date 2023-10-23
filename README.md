# pdjr-skplugin-interfacewatchdog

Interface activity watchdog for Signal K.

## Description

**pdjr-skplugin-interfacewatchdog** monitors the activity of one or
more specified Signal K interfaces, triggering an exception when
throughput on an interface falls outside some specified parameters.

Each interface is monitored for a failure to start producing data as
well as for the circumstance where its data throughput falls below a
certain threshold,
This allows detection of interfaces which fail to operate on start-up
as well as interface failures during normal operation.

When the plugin detects an issue with an interface it responds by
writing a message to the server log, issuing a notification, and,
either disabling monitoring or restarting the host Signal K server.
If server restarting is configured, the maximum number of allowed
restarts can be limited to prevent a persistent loss of service
resulting from runaway reboots.

## Configuration

The plugin configuration consists of 'Interface' objects, each of
which configures watchdog behaviour for a single Signal K interface.

<dl>
  <dt>Interface name <code>name</code></dt>
  <dd>
    Required string property specifying the Signal K interface that
    should be monitored.
    This must match one of the ID's displayed in the Signal K dashboard
    under <em>Server -> Data Connections</em>.
  </dd>
  <dt>Activity threshold in deltas/s <code>threshold</code></dt>
  <dd>
    Optional integer data rate (in deltas per second) at or below which
    an exception should be raised.
    Defaults to 0 which will only identify interfaces that are completely
    dead.
  <dd>
  <dt>Wait this number of cycles for activity <code>waitForActivity</code></dt>
  <dd>
    Optional number of server status reporting cycles to wait for activity
    on the interface to rise above <em>threshold</em> before raising an
    exception (0 says wait indefinitely and so disables watchdog function
    on this interface.).
    Defaults to 3 which equates to about 10 - 15 seconds.
  </dd>
  <dt>Maximum number of restart attempts <code>restartLimit</code></dt>
  <dd>
    Optional number of allowed consecutive server restarts because of
    exceptions on this interface.
    Defaults to 3.
    A value of 0 disables any attempts to wake-up this interface by
    re-starting Signal K: in this case, if the interface is still dead
    after <em>waitForActivity</em> reporting cycles, then monitoring of
    the interface will be disabled.
  </dd>
  <dt>Notification path <code>notificationPath</code></dt>
  <dd>
    Optional path under 'vessels.self.' on which the plugin should issue
    status notifications.
    If omitted, then the path 'notifications.plugins.interfacewatchdog.<em>interface</em>'
    will be used.
  </dd>
</dl>

## Operation

The plugin uses the Signal K SERVERINFO event mechanism as its basic
processing heartbeat and its source of information on interface
throughput.
Typically, Signal K generates SERVERINFO events every four or five
seconds.

An interface becomes liable for processing by the plugin if its
*waitForActivity* configuration property is non-zero.

If, after *waitForActivity* SERVERINFO events have occurred, an
interface's throughput statistic is less than or equal to its
configured *threshold* then a log message and an 'alarm'
notification are issued and, if *restartLimit* is non-zero, then
a restart-cycle is started.has not been exceeded
then the Signal K node service will be killed.
Any restart kill signal is issued approximately one second after the
associated alarm notification: this delay is designed to allow an alarm
handler or annunciator to detect the alarm condition and do its thing.

If the reported interface throughput is above the specified threshold
then a 'normal' notification is issued on the specified notification
path.
  
If and when the Signal K Node process is killed it will only restart
automatically if, as is normally the case, Signal K is started by the
host operating system's process manager and it is configured to support
this behaviour.

Actions taken by the plugin are written to the server log.

## Author

Paul Reeve <*preeve_at_pdjr_dot_eu*>
