import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout';
import { ToastContainer } from './components/common/Toast';
import { Overview, Queues, Jobs, Analytics, Crons, Workers, Settings, ServerMetrics } from './pages';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 5000,
      staleTime: 2000,
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
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
