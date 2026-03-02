import axios from 'axios';
import { getCookie } from '../utils/cookieHelper';

// base instance with credentials to allow cookies
const api = axios.create({
  baseURL: '/api/',
  withCredentials: true, // send cookies
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  response => response,
  err => {
    const originalRequest = err.config;

    if (err.response) {
      const status = err.response.status;

      if (status === 401 && !originalRequest._retry) {
        // access token expired or invalid
        if (isRefreshing) {
          return new Promise(function (resolve, reject) {
            failedQueue.push({ resolve, reject });
          })
            .then(token => {
              originalRequest.headers['Authorization'] = 'Bearer ' + token;
              return api(originalRequest);
            })
            .catch(err => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        // attempt refresh token via cookie
        return new Promise(function (resolve, reject) {
          api
            .post('auth/token/refresh/')
            .then(({ data }) => {
              const newToken = data.access;
              api.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
              originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
              processQueue(null, newToken);
              resolve(api(originalRequest));
            })
            .catch(err => {
              processQueue(err, null);
              reject(err);
            })
            .finally(() => {
              isRefreshing = false;
            });
        });
      } else if (status === 403) {
        // forbidden, perhaps trust score dropped
        // we simply propagate the error; UI can handle showing message
        return Promise.reject(err);
      } else if (status === 429) {
        // rate limited
        alert('Too many requests. Please wait a few minutes.');
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
