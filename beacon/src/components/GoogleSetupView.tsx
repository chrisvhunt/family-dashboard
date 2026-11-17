import { GoogleSettingsPanel } from './GoogleSettingsPanel';
import { useBridgeConfig } from '../hooks/useBridgeConfig';
import { isBridgeConfigured, saveBridgeConfig } from '../api/google-bridge';
import beaconIcon from '../assets/beacon-app-icon.svg';

interface GoogleSetupViewProps {
  /** Show Beacon's original Home Assistant sign-in instead. */
  onUseHomeAssistant: () => void;
}

/** First-run screen when Beacon runs on its own (no Home Assistant). */
export function GoogleSetupView({ onUseHomeAssistant }: GoogleSetupViewProps) {
  const cfg = useBridgeConfig();
  const connected = isBridgeConfigured(cfg);

  return (
    <div className="google-setup">
      <div className="google-setup-card">
        <div className="google-setup-header">
          <img src={beaconIcon} alt="" width={48} height={48} />
          <div>
            <h1 className="google-setup-title">Set up your dashboard</h1>
            <p className="google-setup-sub">
              Connect your Google Calendar and Google Tasks, pick your city for weather and local news, and choose the
              topics you want to follow. You can change any of this later in Settings → Google &amp; News.
            </p>
          </div>
        </div>

        <GoogleSettingsPanel />

        <div className="google-setup-footer">
          <button type="button" className="google-link-btn" onClick={onUseHomeAssistant}>
            I use Home Assistant instead
          </button>
          <div className="google-setup-footer-right">
            {!connected && (
              <button type="button" className="settings-btn" onClick={() => saveBridgeConfig({ setupDone: true })}>
                Skip for now
              </button>
            )}
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              disabled={!connected}
              onClick={() => saveBridgeConfig({ setupDone: true })}
            >
              Open dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
