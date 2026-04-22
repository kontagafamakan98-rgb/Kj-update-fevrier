import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

const normalizeToastInput = (input, fallbackType, fallbackDuration) => {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const { type, duration, ...rest } = input;
    return {
      type: type || fallbackType,
      duration: duration ?? fallbackDuration,
      ...rest
    };
  }

  return {
    message: input,
    type: fallbackType,
    duration: fallbackDuration
  };
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const addToast = useCallback((input, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    const normalizedToast = normalizeToastInput(input, type, duration);
    const toast = { id, ...normalizedToast };

    setToasts(prev => [...prev, toast]);

    if (toast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, toast.duration);
    }

    return id;
  }, [removeToast]);

  const success = useCallback((message, duration) => {
    return addToast(message, 'success', duration);
  }, [addToast]);

  const error = useCallback((message, duration) => {
    return addToast(message, 'error', duration);
  }, [addToast]);

  const info = useCallback((message, duration) => {
    return addToast(message, 'info', duration);
  }, [addToast]);

  const warning = useCallback((message, duration) => {
    return addToast(message, 'warning', duration);
  }, [addToast]);

  const value = {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    info,
    warning
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
};

export default ToastContext;
