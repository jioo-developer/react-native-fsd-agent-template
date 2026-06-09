import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { env } from '@shared/config';

// 인증 실패 시 호출할 콜백 타입 정의
type TAuthFailureCallback = () => void;

// 인증 실패 콜백을 저장하는 변수
let onAuthFailure: TAuthFailureCallback | null = null;

// 외부에서 인증 실패 콜백을 등록할 수 있는 함수
export const setAuthFailureCallback = (callback: TAuthFailureCallback): void => {
  onAuthFailure = callback;
};

// SecureStore에 저장하는 토큰 키 상수
const TOKEN_KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
} as const;

export const tokenManager = {
  // 액세스 토큰을 SecureStore에 저장
  setAccessToken: async (token: string): Promise<void> => {
    await SecureStore.setItemAsync(TOKEN_KEYS.ACCESS_TOKEN, token);
  },

  // 저장된 액세스 토큰을 가져오기
  getAccessToken: async (): Promise<string | null> => {
    return SecureStore.getItemAsync(TOKEN_KEYS.ACCESS_TOKEN);
  },

  // 리프레시 토큰을 SecureStore에 저장
  setRefreshToken: async (token: string): Promise<void> => {
    await SecureStore.setItemAsync(TOKEN_KEYS.REFRESH_TOKEN, token);
  },

  // 저장된 리프레시 토큰을 가져오기
  getRefreshToken: async (): Promise<string | null> => {
    return SecureStore.getItemAsync(TOKEN_KEYS.REFRESH_TOKEN);
  },

  // 액세스 토큰과 리프레시 토큰을 동시에 저장
  setTokens: async (accessToken: string, refreshToken: string): Promise<void> => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEYS.ACCESS_TOKEN, accessToken),
      SecureStore.setItemAsync(TOKEN_KEYS.REFRESH_TOKEN, refreshToken),
    ]);
  },

  // 저장된 토큰을 모두 삭제
  clearTokens: async (): Promise<void> => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(TOKEN_KEYS.REFRESH_TOKEN),
    ]);
  },

  // 액세스 토큰이 있는지 여부 확인
  hasTokens: async (): Promise<boolean> => {
    const accessToken = await SecureStore.getItemAsync(TOKEN_KEYS.ACCESS_TOKEN);
    return !!accessToken;
  },
};

// 토큰 갱신 진행 중인지 상태 저장
let isRefreshing = false;

// 토큰 갱신 후 재시도할 요청들의 콜백 목록
let refreshSubscribers: ((token: string) => void)[] = [];

// 토큰이 갱신되면 대기 중인 요청을 모두 다시 실행
const onRefreshed = (token: string): void => {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
};

// 토큰 갱신을 기다리는 요청을 구독자 목록에 추가
const addRefreshSubscriber = (callback: (token: string) => void): void => {
  refreshSubscribers.push(callback);
};

// 인증이 필요 없는 공개 API 경로 목록
const PUBLIC_ENDPOINTS = ['/auth/login', '/auth/signup', '/auth/refresh'];

// 요청 URL이 공개 API인지 확인
const isPublicEndpoint = (url: string | undefined): boolean => {
  if (!url) return false;
  return PUBLIC_ENDPOINTS.some((endpoint) => url.includes(endpoint));
};

// Axios 인스턴스 생성: baseURL과 기본 헤더 설정
export const apiClient: AxiosInstance = axios.create({
  baseURL: env.API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  async (config) => {
    // 공개 API가 아니라면 액세스 토큰을 가져와 Authorization 헤더에 추가
    if (!isPublicEndpoint(config.url)) {
      const token = await tokenManager.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }

    // 개발 모드에서 요청 로그 출력
    if (__DEV__) {
      console.log('[API Request]', config.method?.toUpperCase(), config.url);
    }

    return config;
  },
  (error) => {
    // 요청 인터셉터에서 발생한 에러 로깅
    console.error('[API Request Error]', error);
    return Promise.reject(error);
  },
);

apiClient.interceptors.response.use(
  (response) => {
    // 개발 모드에서 응답 로그 출력
    if (env.IS_DEV && env.DEBUG) {
      console.log('[API Response]', response.status, response.config.url);
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config;

    // 401 이외의 오류는 에러 로그로 남김
    if (error.response?.status !== 401) {
      console.error('[API Response Error]', {
        status: error.response?.status,
        url: error.config?.url,
        message: error.message,
      });
    }

    // 인증 오류(401) 처리
    if (error.response?.status === 401 && originalRequest) {
      // 공개 API인 경우 바로 에러 반환
      if (isPublicEndpoint(originalRequest.url)) {
        return Promise.reject(error);
      }

      // 리프레시 토큰 요청 자체에서 401이 발생하면 세션 만료 처리
      if (originalRequest.url?.includes('/auth/refresh')) {
        await tokenManager.clearTokens();
        if (onAuthFailure) {
          onAuthFailure();
        }
        return Promise.reject(error);
      }

      // 토큰 갱신이 이미 진행 중이면 기존 갱신이 완료될 때까지 대기
      if (isRefreshing) {
        return new Promise((resolve) => {
          addRefreshSubscriber((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      // 토큰 갱신 시작
      isRefreshing = true;

      try {
        const refreshToken = await tokenManager.getRefreshToken();

        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        // 리프레시 토큰으로 새로운 액세스 토큰 발급 요청
        const response = await axios.post<{
          success: boolean;
          accessToken: string;
          refreshToken: string;
        }>(`${env.API_URL}/auth/refresh`, { refreshToken });

        const { accessToken, refreshToken: newRefreshToken } = response.data;

        // 발급된 토큰 저장 및 대기 중인 요청 재실행
        await tokenManager.setTokens(accessToken, newRefreshToken);
        onRefreshed(accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch {
        // 토큰 갱신 실패 시 저장된 토큰 삭제 및 인증 실패 콜백 호출
        await tokenManager.clearTokens();
        refreshSubscribers = [];

        if (onAuthFailure) {
          onAuthFailure();
        }

        return Promise.reject(new Error('Session expired'));
      } finally {
        // 갱신 작업 완료 후 상태 초기화
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) => {
    return apiClient.get<T>(url, config);
  },

  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => {
    return apiClient.post<T>(url, data, config);
  },

  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => {
    return apiClient.put<T>(url, data, config);
  },

  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => {
    return apiClient.patch<T>(url, data, config);
  },

  delete: <T>(url: string, config?: AxiosRequestConfig) => {
    return apiClient.delete<T>(url, config);
  },
};

// 기본 api 객체를 디폴트로 내보냄
export default api;
