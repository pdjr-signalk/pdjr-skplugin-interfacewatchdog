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
optionally, restarting the host Signal K server.
If server restarting is configured, the maximum number of allowed
restarts can be limited to prevent a persistent loss of service
resulting from multiple reboots.

## Configuration

The plugin configuration consists of one or more interface
has the following properties.

| Property         | Default     | Description |
| :--------------- | :---------- | :---------- |
| interfaces       | []          | Required array of *interface* objects. |

Each *interface* object has the following properties.

| Property         | Default     | Description |
| :--------------- | :---------- | :---------- |
| interface        | (none)      | Required name of the Signal K interface that should be monitored. |
| threshold        | 0           | Optional integer data rate (in deltas per second) at or below which an exception should be raised. |
| waitForActivity  | 2           | Optional number of server event cycles to wait for activity to rise above *threshold* before raising an exception (0 says wait indefinitely). |
| restart          | false       | Optional boolean saying whether or not the plugin should restart the Signal K host when an exception is raised. |
| restartLimit     | 3           | Optional number of allowed consecutive server restarts. |
| notificationPath |             | Optional path under `vessels.self.` on which the plugin should issue alarm notifications. If omitted, then the path "notifications.interfacewatchdog.*interface*" will be used. |

If *notificationpath* is omitted, then the path "notifications.interfacewatchdog.*interface*" will be used.

## Operation

The plugin uses the Signal K SERVERINFO server event mechanism as its
basic processing heartbeat and its source of information on interface
throughput.
Typically, Signal K generates SERVERINFO events every four or five
seconds.

An interface becomes liable for processing by the plugin when either
its reported activity exceeds *threshold* or any deferral period set
by *waitForActivity* has expired.

If *interface*'s throughput statistic is less than or equal to
*threshold* then a log message and an 'alarm' notification are issued
and, if *restart* is enabled and *restartLimit* has not been exceeded
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
