const REGISTRATION_FLOW_KEY = 'kojo_registration_flow';
const REGISTRATION_FLOW_TTL_MS = 6 * 60 * 60 * 1000;

const isBrowser = () => typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

export const loadRegistrationFlow = () => {
  if (!isBrowser()) return null;

  try {
    const rawValue = window.sessionStorage.getItem(REGISTRATION_FLOW_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : null;

    if (!parsedValue) {
      return null;
    }

    const updatedAt = Number(parsedValue.updated_at || 0);
    if (updatedAt && (Date.now() - updatedAt) > REGISTRATION_FLOW_TTL_MS) {
      window.sessionStorage.removeItem(REGISTRATION_FLOW_KEY);
      return null;
    }

    return parsedValue;
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
