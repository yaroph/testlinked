export function bindAsyncActionButton(button, handler, options = {}) {
    if (!button || typeof handler !== 'function') return () => {};

    const busyOpacity = String(options.busyOpacity || '0.62');
    const onError = typeof options.onError === 'function' ? options.onError : null;
    let pointerHandled = false;
    let inFlight = false;

    const runHandler = async (event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (inFlight) return;
        inFlight = true;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.style.opacity = busyOpacity;
        try {
            await handler(event);
        } catch (error) {
            if (onError) onError(error);
            else throw error;
        } finally {
            inFlight = false;
            if (button.isConnected) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
                button.style.opacity = '';
            }
        }
    };

    const handlePointerDown = (event) => {
        if (event.button !== 0) return;
        pointerHandled = true;
        runHandler(event).catch(() => {});
    };

    const handleClick = (event) => {
        if (pointerHandled) {
            pointerHandled = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        runHandler(event).catch(() => {});
    };

    button.onpointerdown = handlePointerDown;
    button.onclick = handleClick;

    return () => {
        if (button.onpointerdown === handlePointerDown) button.onpointerdown = null;
        if (button.onclick === handleClick) button.onclick = null;
    };
}
