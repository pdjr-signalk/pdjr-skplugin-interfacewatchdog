# pdjr-skplugin-interfacewatchdog

Interface activity watchdog for Signal K.

## Description

**pdjr-skplugin-interfacewatchdog** monitors the activity of one or
more specified Signal K interfaces, triggering an exception when
throughput on an interface falls to or below some specified rate.

When the plugin detects an issue with an interface it responds by
writing a message to the server log, issuing a 'alert' notification,
and either disabling monitoring or restarting the host Signal K server
in the hope that the interface can be re-awakened.
If server restarting is configured, the maximum number of allowed
restarts must be limited to prevent a persistent loss of service
resulting from runaway reboots on a dead interface.

## Configuration

The plugin configuration consists of 'Interface' objects, each of
which configures watchdog behaviour for a single Signal K interface.

<dl>
  <dt>Watchdog name <code>name</code></dt>
  <dd>
    Optional string property giving a name that will be used in log and
    notification paths to identify this watchdog.; this can be useful
    if you want granular reporting on interface behaviour.
    Defaults to <code>interface</code>.
  </dd>
  <dt>Interface name <code>interface</code></dt>
  <dd>
    Required string property specifying the Signal K interface that
    should be monitored.
    This must match one of the ID's displayed in the Signal K dashboard
    under <em>Server -> Data Connections</em>.
  </dd>
  <dt>Throughput threshold in deltas/s <code>threshold</code></dt>
  <dd>
    Optional integer data rate (in deltas per second) at or below which
    a problem should be logged.
    Defaults to 0 which will only identify interfaces that are completely
    dead.
  <dd>
  <dt>Start taking action after this many problems <code>startActionThreshold</code></dt>
  <dd>
    If the number of problems logged on *interface* reaches this value
    then perform the configured action (see below).
    A value of 0 says wait indefinitely and so disables watchdog
    function on this interface.
    Defaults to 3.
  </dd>
  <dt>Stop taking action after this many problems <code>stopActionThreshold</code></dt>
  <dd>
    If the number of problems logged on *interface* reaches this value
    then stop performing the configured action and stop watching this
    interface.
    The supplied value must be greater than *startActionThreshold*.
    Defaults to 6.
  </dd>
  <dt>Action to take? <code>action</code></dt>
  <dd>
  The action to take on each problem event between
  <code>startActionThreshold</code> and <code>stopActionThreshold</code>.
  Must be one of 'none', 'kill-watchdog' or 'restart-server'.
  Defaults to 'kill-watchdog'.
  </dd>
  <dt>Notification path <code>notificationPath</code></dt>
  <dd>
    Optional path under 'vessels.self.' on which the plugin should issue
    status notifications.
    If omitted, then the path 'notifications.plugins.interfacewatchdog.<em>interface</em>'
    will be used.
  </dd>
</dl>

There is no restriction on the number of times an interface can
occur in the *Interfaces* array so long as each watchdog has a unique
name (although it only makes sense if one watchdog triggers a reboot).
My ship has two NMEA busses bridged to a single interface and careful
setting of *threshold* on two *Interface* configurations allows me to
monitor the presence/absence of both data streams.

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
