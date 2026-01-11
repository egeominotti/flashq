use axum::{response::Html, routing::get, Router};

const DASHBOARD_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MagicQueue Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        primary: '#818cf8',
                        dark: {
                            900: '#0f172a',
                            800: '#1e293b',
                            700: '#334155',
                            600: '#475569',
                        }
                    }
                }
            }
        }
    </script>
    <style>
        .tab-active { border-bottom: 2px solid #818cf8; color: #818cf8; }
        .state-waiting { background: #3b82f6; }
        .state-delayed { background: #eab308; }
        .state-active { background: #22c55e; }
        .state-completed { background: #10b981; }
        .state-failed { background: #ef4444; }
        .state-waiting-children { background: #8b5cf6; }
        .state-unknown { background: #6b7280; }
        .event-completed { border-left-color: #10b981; }
        .event-failed { border-left-color: #ef4444; }
        .event-pushed { border-left-color: #3b82f6; }
        .event-progress { border-left-color: #eab308; }
        .event-timeout { border-left-color: #f97316; }
        #activity-feed { scrollbar-width: thin; scrollbar-color: #475569 #1e293b; }
        #activity-feed::-webkit-scrollbar { width: 6px; }
        #activity-feed::-webkit-scrollbar-track { background: #1e293b; }
        #activity-feed::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
    </style>
</head>
<body class="bg-dark-900 text-slate-200 min-h-screen">
    <div class="max-w-7xl mx-auto px-4 py-8">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                    </svg>
                </div>
                <h1 class="text-2xl font-bold text-white">MagicQueue</h1>
            </div>
            <div class="flex items-center gap-3">
                <span id="sse-status" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    <span class="w-2 h-2 bg-yellow-400 rounded-full"></span>
                    Connecting...
                </span>
            </div>
        </div>

        <!-- Tabs -->
        <div class="flex gap-4 border-b border-dark-700 mb-6 overflow-x-auto">
            <button onclick="showTab('overview')" id="tab-overview" class="pb-3 px-1 text-sm font-medium transition-colors tab-active whitespace-nowrap">
                Overview
            </button>
            <button onclick="showTab('jobs')" id="tab-jobs" class="pb-3 px-1 text-sm font-medium text-slate-400 hover:text-white transition-colors whitespace-nowrap">
                Job Browser
            </button>
            <button onclick="showTab('crons')" id="tab-crons" class="pb-3 px-1 text-sm font-medium text-slate-400 hover:text-white transition-colors whitespace-nowrap">
                Cron Jobs
            </button>
            <button onclick="showTab('workers')" id="tab-workers" class="pb-3 px-1 text-sm font-medium text-slate-400 hover:text-white transition-colors whitespace-nowrap">
                Workers
            </button>
            <button onclick="showTab('activity')" id="tab-activity" class="pb-3 px-1 text-sm font-medium text-slate-400 hover:text-white transition-colors whitespace-nowrap">
                Live Activity
            </button>
            <button onclick="showTab('charts')" id="tab-charts" class="pb-3 px-1 text-sm font-medium text-slate-400 hover:text-white transition-colors whitespace-nowrap">
                Analytics
            </button>
        </div>

        <!-- Overview Tab -->
        <div id="content-overview">
            <!-- Stats Cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700 hover:border-blue-500/50 transition-colors">
                    <div class="flex items-center justify-between mb-3">
                        <span class="text-slate-400 text-sm font-medium">Queued Jobs</span>
                        <div class="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center">
                            <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                            </svg>
                        </div>
                    </div>
                    <p class="text-3xl font-bold text-blue-400" id="queued">-</p>
                </div>
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700 hover:border-green-500/50 transition-colors">
                    <div class="flex items-center justify-between mb-3">
                        <span class="text-slate-400 text-sm font-medium">Processing</span>
                        <div class="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center">
                            <svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                            </svg>
                        </div>
                    </div>
                    <p class="text-3xl font-bold text-green-400" id="processing">-</p>
                </div>
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700 hover:border-yellow-500/50 transition-colors">
                    <div class="flex items-center justify-between mb-3">
                        <span class="text-slate-400 text-sm font-medium">Delayed</span>
                        <div class="w-8 h-8 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                            <svg class="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                        </div>
                    </div>
                    <p class="text-3xl font-bold text-yellow-400" id="delayed">-</p>
                </div>
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700 hover:border-red-500/50 transition-colors">
                    <div class="flex items-center justify-between mb-3">
                        <span class="text-slate-400 text-sm font-medium">Failed (DLQ)</span>
                        <div class="w-8 h-8 bg-red-500/10 rounded-lg flex items-center justify-center">
                            <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                            </svg>
                        </div>
                    </div>
                    <p class="text-3xl font-bold text-red-400" id="dlq">-</p>
                </div>
            </div>

            <!-- Metrics Cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700">
                    <span class="text-slate-400 text-sm font-medium">Total Pushed</span>
                    <p class="text-2xl font-bold text-white mt-2" id="total_pushed">-</p>
                </div>
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700">
                    <span class="text-slate-400 text-sm font-medium">Total Completed</span>
                    <p class="text-2xl font-bold text-green-400 mt-2" id="total_completed">-</p>
                </div>
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700">
                    <span class="text-slate-400 text-sm font-medium">Total Failed</span>
                    <p class="text-2xl font-bold text-red-400 mt-2" id="total_failed">-</p>
                </div>
                <div class="bg-dark-800 rounded-xl p-5 border border-dark-700">
                    <span class="text-slate-400 text-sm font-medium">Throughput</span>
                    <p class="text-2xl font-bold text-indigo-400 mt-2" id="throughput">-</p>
                </div>
            </div>

            <!-- Queues Table -->
            <div class="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <div class="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-white">Queues</h2>
                    <span class="text-xs text-slate-500">Auto-refresh every 2s</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr class="border-b border-dark-700">
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Name</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Pending</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Processing</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">DLQ</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Rate Limit</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="queues-table" class="divide-y divide-dark-700"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Job Browser Tab -->
        <div id="content-jobs" class="hidden">
            <!-- Filters & Bulk Actions -->
            <div class="bg-dark-800 rounded-xl p-4 border border-dark-700 mb-6">
                <div class="flex flex-wrap gap-4 items-end">
                    <div class="flex-1 min-w-[200px]">
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">Search Job ID</label>
                        <input type="text" id="job-search" placeholder="Enter job ID..."
                            class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary">
                    </div>
                    <div class="min-w-[150px]">
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">Queue</label>
                        <select id="job-queue-filter" class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary">
                            <option value="">All Queues</option>
                        </select>
                    </div>
                    <div class="min-w-[150px]">
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">State</label>
                        <select id="job-state-filter" class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary">
                            <option value="">All States</option>
                            <option value="waiting">Waiting</option>
                            <option value="delayed">Delayed</option>
                            <option value="active">Active</option>
                            <option value="completed">Completed</option>
                            <option value="failed">Failed</option>
                        </select>
                    </div>
                    <button onclick="searchJobs()" class="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-indigo-500">Search</button>
                    <button onclick="clearJobFilters()" class="px-4 py-2 bg-dark-700 text-slate-300 rounded-lg text-sm font-medium hover:bg-dark-600">Clear</button>
                </div>
                <!-- Bulk Actions -->
                <div id="bulk-actions" class="hidden mt-4 pt-4 border-t border-dark-700 flex items-center gap-3">
                    <span class="text-sm text-slate-400"><span id="selected-count">0</span> selected</span>
                    <button onclick="bulkCancel()" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20">Cancel Selected</button>
                    <button onclick="bulkRetry()" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20">Retry Selected</button>
                    <button onclick="clearSelection()" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-dark-600 text-slate-300 hover:bg-dark-500">Clear Selection</button>
                </div>
            </div>

            <!-- Jobs Table -->
            <div class="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <div class="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <h2 class="text-lg font-semibold text-white">Jobs</h2>
                        <label class="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                            <input type="checkbox" id="select-all-jobs" onchange="toggleSelectAll()" class="rounded bg-dark-700 border-dark-600">
                            Select All
                        </label>
                    </div>
                    <div class="flex items-center gap-4">
                        <span class="text-xs text-slate-500" id="jobs-count">0 jobs</span>
                        <div class="flex gap-2">
                            <button onclick="prevJobPage()" id="prev-page-btn" class="px-2 py-1 bg-dark-700 rounded text-xs disabled:opacity-50" disabled>Prev</button>
                            <span class="text-xs text-slate-400 py-1" id="page-info">Page 1</span>
                            <button onclick="nextJobPage()" id="next-page-btn" class="px-2 py-1 bg-dark-700 rounded text-xs">Next</button>
                        </div>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr class="border-b border-dark-700">
                                <th class="px-3 py-3 w-10"></th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">ID</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Queue</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">State</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Priority</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Attempts</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Created</th>
                                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="jobs-table" class="divide-y divide-dark-700"></tbody>
                    </table>
                </div>
            </div>

            <!-- Job Detail Modal -->
            <div id="job-modal" class="fixed inset-0 bg-black/50 backdrop-blur-sm hidden z-50 flex items-center justify-center">
                <div class="bg-dark-800 rounded-xl border border-dark-700 w-full max-w-2xl max-h-[80vh] overflow-hidden m-4">
                    <div class="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
                        <h3 class="text-lg font-semibold text-white">Job Details</h3>
                        <button onclick="closeJobModal()" class="text-slate-400 hover:text-white">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                    <div class="p-6 overflow-y-auto max-h-[60vh]" id="job-modal-content"></div>
                </div>
            </div>
        </div>

        <!-- Cron Jobs Tab -->
        <div id="content-crons" class="hidden">
            <!-- Create Cron Form -->
            <div class="bg-dark-800 rounded-xl p-6 border border-dark-700 mb-6">
                <h3 class="text-lg font-semibold text-white mb-4">Create Cron Job</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">Name</label>
                        <input type="text" id="cron-name" placeholder="my-cron-job" class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">Queue</label>
                        <input type="text" id="cron-queue" placeholder="tasks" class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">Schedule</label>
                        <input type="text" id="cron-schedule" placeholder="0 * * * * (every minute)" class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">Priority</label>
                        <input type="number" id="cron-priority" value="0" class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary">
                    </div>
                    <div class="md:col-span-2">
                        <label class="block text-xs font-medium text-slate-400 mb-1.5">Data (JSON)</label>
                        <input type="text" id="cron-data" placeholder='{"key": "value"}' class="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary">
                    </div>
                </div>
                <div class="mt-4 flex items-center gap-4">
                    <button onclick="createCron()" class="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-indigo-500">Create Cron Job</button>
                    <span class="text-xs text-slate-500">Schedule: 5-field (min hour day month weekday) or 6-field with seconds</span>
                </div>
            </div>

            <!-- Cron Jobs Table -->
            <div class="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <div class="px-6 py-4 border-b border-dark-700">
                    <h2 class="text-lg font-semibold text-white">Scheduled Cron Jobs</h2>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr class="border-b border-dark-700">
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Name</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Queue</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Schedule</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Priority</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Next Run</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Data</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="crons-table" class="divide-y divide-dark-700"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Workers Tab -->
        <div id="content-workers" class="hidden">
            <div class="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <div class="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-white">Connected Workers</h2>
                    <span class="text-xs text-slate-500">Workers with heartbeat in last 30s are online</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr class="border-b border-dark-700">
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Worker ID</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Queues</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Concurrency</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Jobs Processed</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Last Heartbeat</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
                            </tr>
                        </thead>
                        <tbody id="workers-table" class="divide-y divide-dark-700"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Live Activity Tab -->
        <div id="content-activity" class="hidden">
            <div class="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <div class="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <h2 class="text-lg font-semibold text-white">Live Activity Feed</h2>
                        <span id="event-count" class="px-2 py-0.5 bg-primary/20 text-primary rounded text-xs">0 events</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <label class="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                            <input type="checkbox" id="auto-scroll" checked class="rounded bg-dark-700 border-dark-600">
                            Auto-scroll
                        </label>
                        <button onclick="clearActivityFeed()" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-dark-700 text-slate-300 hover:bg-dark-600">Clear</button>
                    </div>
                </div>
                <div id="activity-feed" class="h-[500px] overflow-y-auto p-4 space-y-2"></div>
            </div>
        </div>

        <!-- Charts Tab -->
        <div id="content-charts" class="hidden">
            <div class="flex gap-4 mb-6">
                <button onclick="setChartRange('5m')" id="range-5m" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white">5 min</button>
                <button onclick="setChartRange('15m')" id="range-15m" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-dark-700 text-slate-300 hover:bg-dark-600">15 min</button>
                <button onclick="setChartRange('1h')" id="range-1h" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-dark-700 text-slate-300 hover:bg-dark-600">1 hour</button>
                <button onclick="setChartRange('all')" id="range-all" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-dark-700 text-slate-300 hover:bg-dark-600">All</button>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="bg-dark-800 rounded-xl border border-dark-700 p-6">
                    <h3 class="text-lg font-semibold text-white mb-4">Throughput (jobs/sec)</h3>
                    <div class="h-64"><canvas id="throughput-chart"></canvas></div>
                </div>
                <div class="bg-dark-800 rounded-xl border border-dark-700 p-6">
                    <h3 class="text-lg font-semibold text-white mb-4">Jobs in System</h3>
                    <div class="h-64"><canvas id="jobs-chart"></canvas></div>
                </div>
                <div class="bg-dark-800 rounded-xl border border-dark-700 p-6">
                    <h3 class="text-lg font-semibold text-white mb-4">Completed vs Failed</h3>
                    <div class="h-64"><canvas id="completion-chart"></canvas></div>
                </div>
                <div class="bg-dark-800 rounded-xl border border-dark-700 p-6">
                    <h3 class="text-lg font-semibold text-white mb-4">Average Latency (ms)</h3>
                    <div class="h-64"><canvas id="latency-chart"></canvas></div>
                </div>
            </div>
        </div>

        <div class="mt-8 text-center text-slate-500 text-sm">MagicQueue Server</div>
    </div>

    <script>
        const API_BASE = window.location.origin;
        let currentTab = 'overview';
        let jobPage = 0;
        const jobsPerPage = 20;
        let chartRange = '5m';
        let charts = {};
        let metricsHistory = [];
        let selectedJobs = new Set();
        let eventSource = null;
        let activityEvents = [];

        // Tab Navigation
        function showTab(tab) {
            document.querySelectorAll('[id^="content-"]').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('[id^="tab-"]').forEach(el => {
                el.classList.remove('tab-active');
                el.classList.add('text-slate-400');
            });
            document.getElementById(`content-${tab}`).classList.remove('hidden');
            document.getElementById(`tab-${tab}`).classList.add('tab-active');
            document.getElementById(`tab-${tab}`).classList.remove('text-slate-400');
            currentTab = tab;
            if (tab === 'jobs') loadJobs();
            if (tab === 'charts') loadCharts();
            if (tab === 'crons') loadCrons();
            if (tab === 'workers') loadWorkers();
            if (tab === 'activity') connectSSE();
        }

        // SSE Connection
        function connectSSE() {
            if (eventSource) return;
            eventSource = new EventSource(`${API_BASE}/events`);
            eventSource.onopen = () => {
                document.getElementById('sse-status').innerHTML = '<span class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span> Live';
                document.getElementById('sse-status').className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20';
            };
            eventSource.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data);
                    addActivityEvent(event);
                } catch (err) {}
            };
            eventSource.onerror = () => {
                document.getElementById('sse-status').innerHTML = '<span class="w-2 h-2 bg-red-400 rounded-full"></span> Disconnected';
                document.getElementById('sse-status').className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20';
                eventSource.close();
                eventSource = null;
                setTimeout(connectSSE, 3000);
            };
        }

        function addActivityEvent(event) {
            activityEvents.unshift(event);
            if (activityEvents.length > 500) activityEvents.pop();
            document.getElementById('event-count').textContent = `${activityEvents.length} events`;
            const feed = document.getElementById('activity-feed');
            const eventEl = document.createElement('div');
            eventEl.className = `p-3 bg-dark-700 rounded-lg border-l-4 event-${event.event_type}`;
            eventEl.innerHTML = `
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-medium text-white">${event.event_type.toUpperCase()}</span>
                    <span class="text-xs text-slate-500">${formatTime(event.timestamp)}</span>
                </div>
                <div class="text-xs text-slate-400">
                    Queue: <span class="text-slate-300">${event.queue}</span> |
                    Job ID: <span class="text-slate-300 font-mono">${event.job_id}</span>
                    ${event.error ? `| Error: <span class="text-red-400">${event.error}</span>` : ''}
                    ${event.progress !== undefined ? `| Progress: <span class="text-yellow-400">${event.progress}%</span>` : ''}
                </div>
            `;
            feed.insertBefore(eventEl, feed.firstChild);
            if (feed.children.length > 100) feed.removeChild(feed.lastChild);
            if (document.getElementById('auto-scroll').checked) feed.scrollTop = 0;
        }

        function clearActivityFeed() {
            activityEvents = [];
            document.getElementById('activity-feed').innerHTML = '';
            document.getElementById('event-count').textContent = '0 events';
        }

        // Overview Functions
        async function fetchStats() {
            try {
                const res = await fetch(`${API_BASE}/stats`);
                const data = await res.json();
                if (data.ok) {
                    document.getElementById('queued').textContent = data.data.queued.toLocaleString();
                    document.getElementById('processing').textContent = data.data.processing.toLocaleString();
                    document.getElementById('delayed').textContent = data.data.delayed.toLocaleString();
                    document.getElementById('dlq').textContent = data.data.dlq.toLocaleString();
                }
            } catch (e) {}
        }

        async function fetchMetrics() {
            try {
                const res = await fetch(`${API_BASE}/metrics`);
                const data = await res.json();
                if (data.ok) {
                    document.getElementById('total_pushed').textContent = data.data.total_pushed.toLocaleString();
                    document.getElementById('total_completed').textContent = data.data.total_completed.toLocaleString();
                    document.getElementById('total_failed').textContent = data.data.total_failed.toLocaleString();
                    document.getElementById('throughput').textContent = data.data.jobs_per_second.toFixed(1) + '/s';
                }
            } catch (e) {}
        }

        async function fetchQueues() {
            try {
                const res = await fetch(`${API_BASE}/queues`);
                const data = await res.json();
                const tbody = document.getElementById('queues-table');
                const queueFilter = document.getElementById('job-queue-filter');
                if (data.ok && data.data.length > 0) {
                    const currentValue = queueFilter.value;
                    queueFilter.innerHTML = '<option value="">All Queues</option>' + data.data.map(q => `<option value="${q.name}">${q.name}</option>`).join('');
                    queueFilter.value = currentValue;
                    tbody.innerHTML = data.data.map(q => `
                        <tr class="hover:bg-dark-700/50">
                            <td class="px-6 py-4 font-medium text-white">${q.name}</td>
                            <td class="px-6 py-4 text-slate-300">${q.pending}</td>
                            <td class="px-6 py-4 text-slate-300">${q.processing}</td>
                            <td class="px-6 py-4">${q.dlq > 0 ? `<span class="text-red-400 font-medium">${q.dlq}</span>` : '<span class="text-slate-500">0</span>'}</td>
                            <td class="px-6 py-4 text-slate-300">${q.rate_limit || '-'}</td>
                            <td class="px-6 py-4">${q.paused ? '<span class="px-2 py-1 rounded-full text-xs bg-yellow-500/10 text-yellow-400">Paused</span>' : '<span class="px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-400">Active</span>'}</td>
                            <td class="px-6 py-4">
                                <div class="flex gap-2">
                                    ${q.paused ? `<button onclick="resumeQueue('${q.name}')" class="px-2 py-1 text-xs rounded bg-green-500/10 text-green-400 hover:bg-green-500/20">Resume</button>` : `<button onclick="pauseQueue('${q.name}')" class="px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20">Pause</button>`}
                                    ${q.dlq > 0 ? `<button onclick="retryDlq('${q.name}')" class="px-2 py-1 text-xs rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20">Retry DLQ</button>` : ''}
                                </div>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-slate-500">No queues yet</td></tr>';
                }
            } catch (e) {}
        }

        async function pauseQueue(name) { await fetch(`${API_BASE}/queues/${name}/pause`, { method: 'POST' }); refresh(); }
        async function resumeQueue(name) { await fetch(`${API_BASE}/queues/${name}/resume`, { method: 'POST' }); refresh(); }
        async function retryDlq(name) { await fetch(`${API_BASE}/queues/${name}/dlq/retry`, { method: 'POST' }); refresh(); }

        // Job Browser Functions
        async function loadJobs() {
            const searchId = document.getElementById('job-search').value.trim();
            const queue = document.getElementById('job-queue-filter').value;
            const state = document.getElementById('job-state-filter').value;
            if (searchId) {
                try {
                    const res = await fetch(`${API_BASE}/jobs/${searchId}`);
                    const data = await res.json();
                    if (data.ok && data.data) { renderJobs([data.data]); document.getElementById('jobs-count').textContent = '1 job'; }
                    else { renderJobs([]); document.getElementById('jobs-count').textContent = 'Not found'; }
                } catch (e) {}
                return;
            }
            let url = `${API_BASE}/jobs?limit=${jobsPerPage}&offset=${jobPage * jobsPerPage}`;
            if (queue) url += `&queue=${encodeURIComponent(queue)}`;
            if (state) url += `&state=${encodeURIComponent(state)}`;
            try {
                const res = await fetch(url);
                const data = await res.json();
                if (data.ok) {
                    renderJobs(data.data || []);
                    const count = data.data?.length || 0;
                    document.getElementById('jobs-count').textContent = `${count} jobs`;
                    document.getElementById('page-info').textContent = `Page ${jobPage + 1}`;
                    document.getElementById('prev-page-btn').disabled = jobPage === 0;
                    document.getElementById('next-page-btn').disabled = count < jobsPerPage;
                }
            } catch (e) {}
        }

        function renderJobs(jobs) {
            const tbody = document.getElementById('jobs-table');
            if (jobs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-slate-500">No jobs found</td></tr>';
                return;
            }
            tbody.innerHTML = jobs.map(j => `
                <tr class="hover:bg-dark-700/50">
                    <td class="px-3 py-3"><input type="checkbox" ${selectedJobs.has(j.id) ? 'checked' : ''} onchange="toggleJobSelection(${j.id})" class="rounded bg-dark-700 border-dark-600"></td>
                    <td class="px-4 py-3 font-mono text-sm text-slate-300">${j.id}</td>
                    <td class="px-4 py-3 text-sm text-white">${j.queue}</td>
                    <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-xs font-medium state-${j.state} text-white">${j.state}</span></td>
                    <td class="px-4 py-3 text-sm text-slate-300">${j.priority}</td>
                    <td class="px-4 py-3 text-sm text-slate-300">${j.attempts}${j.max_attempts > 0 ? '/' + j.max_attempts : ''}</td>
                    <td class="px-4 py-3 text-sm text-slate-400">${formatTime(j.created_at)}</td>
                    <td class="px-4 py-3">
                        <button onclick="showJobDetail(${j.id})" class="px-2 py-1 text-xs bg-dark-700 rounded hover:bg-dark-600">View</button>
                    </td>
                </tr>
            `).join('');
        }

        function toggleJobSelection(id) {
            if (selectedJobs.has(id)) selectedJobs.delete(id);
            else selectedJobs.add(id);
            updateBulkActions();
        }

        function toggleSelectAll() {
            const checkAll = document.getElementById('select-all-jobs').checked;
            document.querySelectorAll('#jobs-table input[type="checkbox"]').forEach(cb => {
                const id = parseInt(cb.getAttribute('onchange').match(/\d+/)[0]);
                if (checkAll) selectedJobs.add(id);
                else selectedJobs.delete(id);
                cb.checked = checkAll;
            });
            updateBulkActions();
        }

        function updateBulkActions() {
            document.getElementById('selected-count').textContent = selectedJobs.size;
            document.getElementById('bulk-actions').classList.toggle('hidden', selectedJobs.size === 0);
        }

        function clearSelection() {
            selectedJobs.clear();
            document.querySelectorAll('#jobs-table input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.getElementById('select-all-jobs').checked = false;
            updateBulkActions();
        }

        async function bulkCancel() {
            for (const id of selectedJobs) {
                await fetch(`${API_BASE}/jobs/${id}/cancel`, { method: 'POST' });
            }
            clearSelection();
            loadJobs();
        }

        async function bulkRetry() {
            for (const id of selectedJobs) {
                await fetch(`${API_BASE}/jobs/${id}/fail`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({error: 'Manual retry'}) });
            }
            clearSelection();
            loadJobs();
        }

        async function showJobDetail(jobId) {
            try {
                const res = await fetch(`${API_BASE}/jobs/${jobId}`);
                const data = await res.json();
                if (data.ok && data.data) {
                    const job = data.data;
                    document.getElementById('job-modal-content').innerHTML = `
                        <div class="space-y-4">
                            <div class="grid grid-cols-2 gap-4">
                                <div><label class="text-xs text-slate-400">Job ID</label><p class="font-mono text-white">${job.id}</p></div>
                                <div><label class="text-xs text-slate-400">State</label><p><span class="px-2 py-0.5 rounded text-xs font-medium state-${job.state} text-white">${job.state}</span></p></div>
                                <div><label class="text-xs text-slate-400">Queue</label><p class="text-white">${job.queue}</p></div>
                                <div><label class="text-xs text-slate-400">Priority</label><p class="text-white">${job.priority}</p></div>
                                <div><label class="text-xs text-slate-400">Attempts</label><p class="text-white">${job.attempts}${job.max_attempts > 0 ? ' / ' + job.max_attempts : ''}</p></div>
                                <div><label class="text-xs text-slate-400">Created At</label><p class="text-white">${formatTime(job.created_at)}</p></div>
                            </div>
                            <div><label class="text-xs text-slate-400">Data</label><pre class="mt-1 p-3 bg-dark-900 rounded-lg text-xs text-slate-300 overflow-x-auto">${JSON.stringify(job.data, null, 2)}</pre></div>
                        </div>
                    `;
                    document.getElementById('job-modal').classList.remove('hidden');
                }
            } catch (e) {}
        }

        function closeJobModal() { document.getElementById('job-modal').classList.add('hidden'); }
        function searchJobs() { jobPage = 0; loadJobs(); }
        function clearJobFilters() { document.getElementById('job-search').value = ''; document.getElementById('job-queue-filter').value = ''; document.getElementById('job-state-filter').value = ''; jobPage = 0; loadJobs(); }
        function prevJobPage() { if (jobPage > 0) { jobPage--; loadJobs(); } }
        function nextJobPage() { jobPage++; loadJobs(); }

        // Cron Functions
        async function loadCrons() {
            try {
                const res = await fetch(`${API_BASE}/crons`);
                const data = await res.json();
                const tbody = document.getElementById('crons-table');
                if (data.ok && data.data.length > 0) {
                    tbody.innerHTML = data.data.map(c => `
                        <tr class="hover:bg-dark-700/50">
                            <td class="px-6 py-4 font-medium text-white">${c.name}</td>
                            <td class="px-6 py-4 text-slate-300">${c.queue}</td>
                            <td class="px-6 py-4 font-mono text-sm text-slate-300">${c.schedule}</td>
                            <td class="px-6 py-4 text-slate-300">${c.priority}</td>
                            <td class="px-6 py-4 text-slate-400">${formatTime(c.next_run)}</td>
                            <td class="px-6 py-4 text-xs text-slate-400 max-w-xs truncate">${JSON.stringify(c.data)}</td>
                            <td class="px-6 py-4"><button onclick="deleteCron('${c.name}')" class="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">Delete</button></td>
                        </tr>
                    `).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-slate-500">No cron jobs configured</td></tr>';
                }
            } catch (e) {}
        }

        async function createCron() {
            const name = document.getElementById('cron-name').value.trim();
            const queue = document.getElementById('cron-queue').value.trim();
            const schedule = document.getElementById('cron-schedule').value.trim();
            const priority = parseInt(document.getElementById('cron-priority').value) || 0;
            let data = {};
            try { data = JSON.parse(document.getElementById('cron-data').value || '{}'); } catch (e) { alert('Invalid JSON data'); return; }
            if (!name || !queue || !schedule) { alert('Name, queue, and schedule are required'); return; }
            try {
                const res = await fetch(`${API_BASE}/crons/${encodeURIComponent(name)}`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ queue, schedule, priority, data })
                });
                const result = await res.json();
                if (result.ok) {
                    document.getElementById('cron-name').value = '';
                    document.getElementById('cron-queue').value = '';
                    document.getElementById('cron-schedule').value = '';
                    document.getElementById('cron-priority').value = '0';
                    document.getElementById('cron-data').value = '';
                    loadCrons();
                } else {
                    alert(result.error || 'Failed to create cron job');
                }
            } catch (e) { alert('Failed to create cron job'); }
        }

        async function deleteCron(name) {
            if (!confirm(`Delete cron job "${name}"?`)) return;
            await fetch(`${API_BASE}/crons/${encodeURIComponent(name)}`, { method: 'DELETE' });
            loadCrons();
        }

        // Workers Functions
        async function loadWorkers() {
            try {
                const res = await fetch(`${API_BASE}/workers`);
                const data = await res.json();
                const tbody = document.getElementById('workers-table');
                const now = Date.now();
                if (data.ok && data.data.length > 0) {
                    tbody.innerHTML = data.data.map(w => {
                        const isOnline = (now - w.last_heartbeat) < 30000;
                        return `
                            <tr class="hover:bg-dark-700/50">
                                <td class="px-6 py-4 font-mono text-sm text-white">${w.id}</td>
                                <td class="px-6 py-4 text-slate-300">${w.queues.join(', ') || '-'}</td>
                                <td class="px-6 py-4 text-slate-300">${w.concurrency}</td>
                                <td class="px-6 py-4 text-slate-300">${w.jobs_processed.toLocaleString()}</td>
                                <td class="px-6 py-4 text-slate-400">${formatTime(w.last_heartbeat)}</td>
                                <td class="px-6 py-4">${isOnline ? '<span class="px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-400">Online</span>' : '<span class="px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-400">Offline</span>'}</td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-slate-500">No workers registered</td></tr>';
                }
            } catch (e) {}
        }

        // Charts Functions
        async function loadCharts() {
            try {
                const res = await fetch(`${API_BASE}/metrics/history`);
                const data = await res.json();
                if (data.ok) { metricsHistory = data.data || []; updateCharts(); }
            } catch (e) {}
        }

        function setChartRange(range) {
            chartRange = range;
            document.querySelectorAll('[id^="range-"]').forEach(el => { el.classList.remove('bg-primary', 'text-white'); el.classList.add('bg-dark-700', 'text-slate-300'); });
            document.getElementById(`range-${range}`).classList.remove('bg-dark-700', 'text-slate-300');
            document.getElementById(`range-${range}`).classList.add('bg-primary', 'text-white');
            updateCharts();
        }

        function filterByRange(data) {
            if (!data.length) return data;
            const now = Date.now();
            const ranges = { '5m': 5*60*1000, '15m': 15*60*1000, '1h': 60*60*1000, 'all': Infinity };
            const cutoff = now - ranges[chartRange];
            return data.filter(d => d.timestamp >= cutoff);
        }

        function updateCharts() {
            const filtered = filterByRange(metricsHistory);
            const labels = filtered.map(d => formatChartTime(d.timestamp));
            const cfg = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }, y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' }, beginAtZero: true } } };
            if (charts.throughput) charts.throughput.destroy();
            charts.throughput = new Chart(document.getElementById('throughput-chart'), { type: 'line', data: { labels, datasets: [{ data: filtered.map(d => d.throughput), borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.1)', fill: true, tension: 0.3 }] }, options: cfg });
            if (charts.jobs) charts.jobs.destroy();
            charts.jobs = new Chart(document.getElementById('jobs-chart'), { type: 'line', data: { labels, datasets: [{ data: filtered.map(d => d.queued), borderColor: '#3b82f6', label: 'Queued', tension: 0.3 }, { data: filtered.map(d => d.processing), borderColor: '#22c55e', label: 'Processing', tension: 0.3 }] }, options: { ...cfg, plugins: { legend: { display: true, labels: { color: '#94a3b8' } } } } });
            if (charts.completion) charts.completion.destroy();
            charts.completion = new Chart(document.getElementById('completion-chart'), { type: 'line', data: { labels, datasets: [{ data: filtered.map(d => d.completed), borderColor: '#10b981', label: 'Completed', tension: 0.3 }, { data: filtered.map(d => d.failed), borderColor: '#ef4444', label: 'Failed', tension: 0.3 }] }, options: { ...cfg, plugins: { legend: { display: true, labels: { color: '#94a3b8' } } } } });
            if (charts.latency) charts.latency.destroy();
            charts.latency = new Chart(document.getElementById('latency-chart'), { type: 'line', data: { labels, datasets: [{ data: filtered.map(d => d.latency_ms), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3 }] }, options: cfg });
        }

        // Utility Functions
        function formatTime(ts) { if (!ts) return '-'; const d = new Date(ts); return d.toLocaleTimeString() + ' ' + d.toLocaleDateString(); }
        function formatChartTime(ts) { const d = new Date(ts); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

        // Main Refresh Loop
        function refresh() {
            if (currentTab === 'overview') { fetchStats(); fetchMetrics(); fetchQueues(); }
            else if (currentTab === 'charts') { loadCharts(); }
            else if (currentTab === 'workers') { loadWorkers(); }
        }

        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeJobModal(); });
        connectSSE();
        refresh();
        setInterval(refresh, 2000);
    </script>
</body>
</html>
"##;

pub fn dashboard_routes() -> Router {
    Router::new()
        .route("/", get(dashboard))
        .route("/dashboard", get(dashboard))
}

async fn dashboard() -> Html<&'static str> {
    Html(DASHBOARD_HTML)
}
