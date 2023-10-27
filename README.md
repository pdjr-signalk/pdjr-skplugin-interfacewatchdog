# pdjr-skplugin-interfacewatchdog

Interface activity watchdog for Signal K.

## Description

**pdjr-skplugin-interfacewatchdog** implements one or more watchdogs
on one or more Signal K interfaces, triggering an exception if
throughput on an interface falls to some specified threshold
rate.

Each watchdog logs key events to the server log and issues Signal K
notifications on its own notification key.

The sensitivity of the watchdog to identified exceptions (i.e. when
an exception becomes a problem) can be configured and the appearance
of a problem can be handled in a number of ways: it can be ignored (in
which case monitoring continues), or the watchdog can be disabled,
or the host Signal K server can be restarted in the hope that the
problem can be corrected by a hard reset of the associated interface.

If server restarting is configured, the maximum number of allowed
restarts can be limited to prevent a persistent loss of service
resulting from runaway reboots on a dead interface.

The plugin exposes an
[HTTP API](https://pdjr-signalk.github.io/pdjr-skplugin-interfacewatchdog/)
and contributes OpenAPI documentation of its interface to the Signal
K OpenAPI service.

## Configuration

The plugin configuration consists of a *Watchdogs* array containing
zero or more *Watchdog* items each of which configures monitoring
of a specified Signal K interface against a specified throughput
threshold.

<dl>
  <dt>Watchdog name <code>name</code></dt>
  <dd>
    Optional string property giving a name that will be used in log and
    notification paths to identify this watchdog.
    Defaults to <em>interface</em>-<em>n</em> where <em>n</em> is an
    integer assigned to ensure uniqueness.
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
    Defaults to *startActionThreshold + 3.
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
occur in the *Watchdogs* array so long as each *Watchdog* has a unique
name (although it only makes sense if one *Watchdog* specifies a
'restart-server' *action*.

### Example configuration

My ship has two NMEA busses bridged to a single Actisense interface
called 'ngt-1'.

Bus0 is my 'domestic' NMEA bus and is expected to be available 24/7.
Typical throughput on 'ngt-1' with just this bus enabled is around 20
deltas per second.

Bus1 is my 'navigation' bus and is expected to be available when
navigating.
Typical throughput on 'ngt1' with both busses enabled is around 60
deltas per second.

Setting appropriate *threshold* values on two *Watchdog* configurations
allows me to monitor and notify the health of both data streams and to
take crude remedial action if the 'ngt-1' interface dies.
```
{
  "configuration": {
    "watchdogs": [
      {
        "name": "Bus0",
        "interface": "ngt-1",
        "threshold": 10,
        "action": "restart-server"
      },
      {
        "name": "Bus1",
        "interface": "ngt-1",
        "threshold": 30,
        "action": "none"
      }
    ]
  },
  "enabled": true,
  "enableDebug": false,
  "enableLogging": false
}
```

## Notifications

Each defined *Watchdog* writes notifications either to its configured
or default *notificationPath*.

<dl>
  <dt>Waiting for interface to become active</dt>
  <dd>
    ALERT notification issued as soon as the watchdog begins watching
    interface throughput.
  </dd>
  <dt>Started normal operation</dt>
  <dd>
    NORMAL notification issued as soon as interface throughput rises
    above the specified watchdog threshold.
  </dd>
  <dt>Server restart <em>n</em> of <em>m</em></dt>
  <dd>
    ALARM notification issued each time an exceptional throughput
    triggers a server restart.
  </dd>
  <dt>Terminating watchdog</dt>
  <dd> 
    WARN notification issued when the watchdog stops monitoring
    its particular interface/threshold combination.
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
