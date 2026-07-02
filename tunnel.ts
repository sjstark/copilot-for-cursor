import { getCursorEndpoint, getPublicUrl } from './public-config';
import { configureCursorOpenAIBaseUrl } from './cursor-settings';

export type TunnelStatus = 'configured' | 'unconfigured';

export interface TunnelState {
    status: TunnelStatus;
    url: string;
    cursorEndpoint: string;
    provider: 'cloudflare';
    note: string;
}

const subscribers = new Set<(s: TunnelState) => void>();

const buildState = (): TunnelState => {
    const url = getPublicUrl();
    return {
        status: url ? 'configured' : 'unconfigured',
        url,
        cursorEndpoint: getCursorEndpoint(),
        provider: 'cloudflare',
        note: 'Cloudflare tunnel runs as a system service and forwards to localhost:4142',
    };
};

const notify = () => {
    const snapshot = buildState();
    for (const cb of subscribers) {
        try {
            cb(snapshot);
        } catch {}
    }
};

export const getTunnelState = (): TunnelState => buildState();

export const subscribeTunnel = (cb: (s: TunnelState) => void): (() => void) => {
    subscribers.add(cb);
    cb(buildState());
    return () => {
        subscribers.delete(cb);
    };
};

export const configureCursor = (): { ok: boolean; message: string } => {
    const result = configureCursorOpenAIBaseUrl(getCursorEndpoint());
    notify();
    return result;
};

/** Kept for compatibility — no ephemeral tunnel to stop. */
export const stopTunnel = async (): Promise<void> => {};
