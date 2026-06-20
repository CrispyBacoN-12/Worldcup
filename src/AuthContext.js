import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('wc_token');
    const username = localStorage.getItem('wc_username');
    if (token && username) {
      setUser({ username, token });
    }
    setLoading(false);
  }, []);

  const login = (username, token) => {
    localStorage.setItem('wc_token', token);
    localStorage.setItem('wc_username', username);
    setUser({ username, token });
  };

  const logout = () => {
    localStorage.removeItem('wc_token');
    localStorage.removeItem('wc_username');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
