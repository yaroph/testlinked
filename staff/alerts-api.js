export function createStaffAlertsApi(options = {}) {
    const endpoint = String(options.endpoint || '').trim();
    const refreshEventKey = String(options.refreshEventKey || '').trim();
    const refreshChannel = String(options.refreshChannel || '').trim();

    async function requestAdmin(action, payload = {}) {
        const staffCode = String(options.getStaffCode?.() || options.staffCode || '').trim();
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-staff-code': staffCode,
            },
            body: JSON.stringify({ ...payload, action, accessCode: staffCode }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            throw new Error(data.error || `Erreur alerte (${response.status})`);
        }
        return data;
    }

    function notifyPublicAlertRefresh() {
        try {
            if (refreshEventKey) localStorage.setItem(refreshEventKey, String(Date.now()));
        } catch (e) {}
        try {
            if (refreshChannel && typeof BroadcastChannel === 'function') {
                const channel = new BroadcastChannel(refreshChannel);
                channel.postMessage({ type: 'refresh', at: Date.now() });
                channel.close();
            }
        } catch (e) {}
    }

    return {
        requestAdmin,
        notifyPublicAlertRefresh,
    };
}
