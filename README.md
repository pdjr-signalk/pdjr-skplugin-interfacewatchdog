# pdjr-skplugin-interfacewatchdog

Interface activity watchdog for Signal K.

## Description

**pdjr-skplugin-interfacewatchdog** monitors the activity of one or
more specified Signal K interfaces, triggering an exception when
throughput on an interface falls outside some specified parameters.

Each interface is monitored for a failure to start producing data as
well as for the circumstance where throughput on an established data
connection falls below a certain threshold. 
This allows detection of interfaces which fail to operate on start-up
as well interfaces which fail or lock-up during normal operation.

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

An interface will be monitored by the plugin if its *waitForActivity*
configuration property has a non-zero value.

If throughput on a monitored interface falls below and remains below
the configured *threshold* value for *waitForActivity* heartbeats then
the interface is considered to be in a problem state.
The plugin will handle this condition in one of two ways dependent upon
the value of the *rebootLimit* configuration property.

If *rebootLimit* is zero, then a 'warn' notification is issued on the
configured *notificationPath* and the interface is removed from further
monitoring.

If *rebootLimit* is non-zero, then the plugin will commence a sequence
of server restarts up to the maximum configured by *rebootLimit*.
After each restart the interface is monitored in the way described
obove to determine whether or not the interface has been restored to a
working state.
A second or two before a restart sequence commences, an 'alert'
notification is issued on *notificationPath*: this advance warning
aims to allow an alarm handler or annunciator to detect the 'alert'
condition and do its thing before the host server is restarted.

If the restart sequence fails to restore interface throughput above
*threshold*, then a 'warn' notification is issued and the interface is
removed from further monitoring.

If throughput on a problem interface recovers above *threshold* then
a 'normal' notification is issued and monitoring proceeds as usual.
  
Be aware that a server restart is initiated by killing the parent Node
process: Signal K will only restart automatically if, as will be the
case after a normal installation, it is configured to be started by
the host operating system's process manager.

Significant actions taken by the plugin are written to the server log.

## Author

Paul Reeve <*preeve_at_pdjr_dot_eu*>
