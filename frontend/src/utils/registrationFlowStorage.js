const REGISTRATION_FLOW_KEY = 'kojo_registration_flow';

const isBrowser = () => typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

export const loadRegistrationFlow = () => {
  if (!isBrowser()) return null;

  try {
    const rawValue = window.sessionStorage.getItem(REGISTRATION_FLOW_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    return null;
  }
};

export const saveRegistrationFlow = (flowData) => {
  if (!isBrowser()) return;

  try {
    window.sessionStorage.setItem(REGISTRATION_FLOW_KEY, JSON.stringify({
      ...flowData,
      updated_at: Date.now()
    }));
  } catch (error) {
    // Ignore storage errors silently to avoid blocking registration
  }
};

export const mergeRegistrationFlow = (partialFlowData) => {
  const currentFlow = loadRegistrationFlow() || {};
  saveRegistrationFlow({
    ...currentFlow,
    ...partialFlowData
  });
};

export const clearRegistrationFlow = () => {
  if (!isBrowser()) return;

  try {
    window.sessionStorage.removeItem(REGISTRATION_FLOW_KEY);
  } catch (error) {
    // Ignore storage errors silently
  }
};
