import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout';
import { ToastContainer } from './components/common/Toast';
import {
  Overview,
  Queues,
  Jobs,
  Analytics,
  Crons,
  Workers,
  Settings,
  ServerMetrics,
} from './pages';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { WebSocketProvider } from './contexts';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Disable polling - WebSocket handles real-time data
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <WebSocketProvider>
              <Layout>
                <Routes>
                  <Route path="/" element={<Overview />} />
                  <Route path="/queues" element={<Queues />} />
                  <Route path="/jobs" element={<Jobs />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/crons" element={<Crons />} />
                  <Route path="/workers" element={<Workers />} />
                  <Route path="/server-metrics" element={<ServerMetrics />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Layout>
              <ToastContainer />
            </WebSocketProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
