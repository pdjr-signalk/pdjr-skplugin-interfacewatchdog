export class Watchdog {

  interface: string = '';
  name: string = '';
  threshold: number = 0;
  startActionThreshold: number = 0;
  stopActionThreshold: number = 0;
  action: string = '';
  notificationPath: string = '';

  state: string = '';
  stateHistory: string[] = [];

  exceptionCount: number = 0;
  restartCount?: number = 0;
  problemCount: number = 0;
  problemsSinceLastRestart: number = 0;
  problemsSinceFileCreation: number = 0;

  constructor(watchdogOptions: any, defaults: any) {
    if (!watchdogOptions.interface) throw new Error('missing \'interface\' property');

    this.name = watchdogOptions.name || `${watchdogOptions.interface}-${interfaceNumbers[watchdogOptions.interface]++}`;
    this.interface = watchdogOptions.interface;
    this.threshold = watchdogOptions.threshold || defaults.THRESHOLD;
    this.startActionThreshold = watchdogOptions.startActionThreshold || defaults.START_ACTION_THRESHOLD;
    this.stopActionThreshold = watchdogOptions.stopActionThreshold || (this.startActionThreshold + defaults.STOP_ACTION_THRESHOLD_OFFSET);
    this.action = watchdogOptions.action || defaults.ACTION;
    this.notificationPath = watchdogOptions.notificationPath || `notifications.plugins.${defaults.PLUGIN_ID}.watchdogs.${this.name}`;

    const interfaceNumbers: Dictionary<number> = options.watchdogs.reduce((a: Dictionary<number>, w: Watchdog) => { if (w.interface) a[w.interface] = 0; return(a); }, {});

    var pluginConfiguration: PluginConfiguration = {
      watchdogs: options.watchdogs.reduce((a: Watchdog[], watchdogOptions: any) => {
        try {
          if (!watchdogOptions.interface) throw new Error('missing \'interface\' property');
          var watchdog: Watchdog = <Watchdog>{};
          watchdog.name = watchdogOptions.name || `${watchdogOptions.interface}-${interfaceNumbers[watchdogOptions.interface]++}`;
          watchdog.interface = watchdogOptions.interface;
          watchdog.threshold = watchdogOptions.threshold || DEFAULT_THRESHOLD;
          watchdog.startActionThreshold = watchdogOptions.startActionThreshold || DEFAULT_START_ACTION_THRESHOLD;
          watchdog.stopActionThreshold = watchdogOptions.stopActionThreshold || (watchdog.startActionThreshold + DEFAULT_STOP_ACTION_THRESHOLD_OFFSET);
          watchdog.action = watchdogOptions.action || DEFAULT_ACTION;
          watchdog.notificationPath = watchdogOptions.notificationPath || `notifications.plugins.${plugin.id}.watchdogs.${watchdog.name}`;
          a.push(watchdog);
        } catch(e: any) {
          app.debug(`ignoring watchdog with ${e.message}`);
        }
        return(a);
      }, [])
    }
    return(pluginConfiguration);


  }

}

interface Dictionary<T> {
  [key: string]: T  
}