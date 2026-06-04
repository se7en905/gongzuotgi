<template>
  <div v-if="hasAlerts" class="critical-notification-layer" :class="{ 'is-drawer-open': drawerVisible }">
    <button class="critical-alarm-button" type="button" @click="toggleDrawer">
      <ElIcon><Bell /></ElIcon>
      <span>高压通知</span>
      <b>{{ summary.total }}</b>
    </button>

    <button v-if="drawerVisible" class="critical-drawer-mask" type="button" aria-label="关闭强提醒队列" @click="drawerVisible = false"></button>

    <aside v-if="drawerVisible" class="critical-drawer" aria-label="强提醒队列">
      <header>
        <div>
          <span>强提醒队列</span>
          <h2>{{ summary.total }} 条待处理</h2>
        </div>
        <button type="button" @click="drawerVisible = false">关闭</button>
      </header>

      <div class="critical-drawer-metrics">
        <button v-for="metric in alertMetrics" :key="metric.key" type="button" @click="goMetric(metric.metric)">
          <strong>{{ metric.value }}</strong>
          <span>{{ metric.label }}</span>
        </button>
      </div>

      <div class="critical-alert-list">
        <article v-for="alert in alerts" :key="alert.id" :class="['critical-alert-card', `is-${alert.tone}`]">
          <div class="critical-alert-card-head">
            <span>{{ alert.badge }}</span>
            <b>{{ alert.owner }}</b>
          </div>
          <button type="button" @click="openAlert(alert)">
            <strong>{{ alert.title }}</strong>
            <small>{{ alert.meta }}</small>
          </button>
        </article>
      </div>
    </aside>

    <div v-if="modalVisible" class="critical-modal-backdrop">
      <section class="critical-modal">
        <header>
          <span>紧急通知</span>
          <div class="critical-modal-risk-list">
            <button v-for="row in modalRows" :key="row.key" type="button" @click.stop.prevent="goMetric(row.metric)">
              <strong>{{ row.value }}</strong>
              <span>{{ row.label }}</span>
            </button>
          </div>
        </header>
        <p>系统会继续保留顶部警戒条和右侧队列，直到风险数量下降。</p>
        <div v-if="notificationSupported" class="critical-browser-notice">
          <span>{{ browserNoticeText }}</span>
          <button v-if="notificationPermission !== 'granted'" type="button" @click.stop.prevent="enableBrowserNotification">
            开启浏览器通知
          </button>
          <button v-else type="button" @click.stop.prevent="sendBrowserNotification(true)">
            测试通知
          </button>
        </div>
        <div class="critical-modal-actions">
          <button class="primary" type="button" @click.stop.prevent="goMetric(primaryMetric)">立即处理</button>
          <button type="button" @click.stop.prevent="acknowledge">我知道了</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
export default {
  name: 'CriticalNotificationLayer',
  props: {
    app: {
      type: Object,
      required: true
    },
    tasks: {
      type: Array,
      default: () => []
    },
    bugs: {
      type: Array,
      default: () => []
    },
    metrics: {
      type: Array,
      default: () => []
    },
    canViewTasks: {
      type: Boolean,
      default: false
    },
    activeView: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      drawerVisible: false,
      modalVisible: false,
      acknowledgedKey: '',
      modalDismissed: false,
      notificationPermission: this.currentNotificationPermission(),
      notifiedAlertKey: '',
      browserNoticeStatus: ''
    };
  },
  computed: {
    taskRows() {
      return this.tasks;
    },
    bugRows() {
      return this.bugs;
    },
    todayDueTasks() {
      const today = this.todayKey();
      return this.taskRows.filter(task => task.deadline === today && !this.isClosedTask(task));
    },
    riskTasks() {
      return this.taskRows.filter(task => this.app.isArtTaskRisk(task));
    },
    overdueBugs() {
      const today = this.todayKey();
      return this.bugRows.filter(bug => bug.deadline && bug.deadline < today && !this.isClosedBug(bug));
    },
    urgentBugs() {
      return this.bugRows.filter(bug => !this.isClosedBug(bug) && (Number(bug.pri || 0) <= 2 || Number(bug.severity || 0) <= 2));
    },
    activeBugs() {
      return this.bugRows.filter(bug => !this.isClosedBug(bug));
    },
    summary() {
      const metricMap = new Map(this.metrics.map(metric => [metric.filter, metric.value]));
      const dueToday = this.numberMetric(metricMap.get('todayDue'), this.todayDueTasks.length);
      const riskTasks = this.numberMetric(metricMap.get('riskTask'), this.riskTasks.length);
      const activeBugs = this.numberMetric(metricMap.get('webBug'), this.activeBugs.length);
      const urgentBugs = this.numberMetric(metricMap.get('urgentBug'), this.urgentBugs.length);
      const overdueBugs = this.overdueBugs.length;
      return {
        dueToday,
        riskTasks,
        activeBugs,
        overdueBugs,
        urgentBugs,
        total: dueToday + riskTasks + activeBugs
      };
    },
    alertMetrics() {
      return [
        { key: 'dueToday', label: '今日截止', value: this.summary.dueToday, metric: 'todayDue' },
        { key: 'riskTasks', label: '卡点任务', value: this.summary.riskTasks, metric: 'riskTask' },
        { key: 'activeBugs', label: '待处理 Bug', value: this.summary.activeBugs, metric: 'webBug' },
        { key: 'urgentBugs', label: '高优 Bug', value: this.summary.urgentBugs, metric: 'urgentBug' }
      ];
    },
    modalRows() {
      return this.alertMetrics
        .filter(metric => Number(metric.value || 0) > 0)
        .sort((a, b) => this.modalMetricPriority(a) - this.modalMetricPriority(b));
    },
    alerts() {
      const bugAlerts = this.uniqueBugAlerts([
        ...this.overdueBugs.slice(0, 5).map(bug => this.bugAlert(bug, 'Bug 逾期', 'red')),
        ...this.urgentBugs.slice(0, 5).map(bug => this.bugAlert(bug, '高优 Bug', 'yellow'))
      ]);
      return [
        ...this.todayDueTasks.slice(0, 6).map(task => this.taskAlert(task, '截止今天', 'red')),
        ...this.riskTasks.slice(0, 6).map(task => this.taskAlert(task, '卡点任务', 'orange')),
        ...bugAlerts
      ].slice(0, 18);
    },
    headline() {
      if (this.summary.dueToday) return `今天有 ${this.summary.dueToday} 个禅道单截止`;
      if (this.summary.riskTasks) return `还有 ${this.summary.riskTasks} 个任务需要关注`;
      return `当前有 ${this.summary.activeBugs} 个 Bug 待处理`;
    },
    subline() {
      return `卡点任务 ${this.summary.riskTasks}，待处理 Bug ${this.summary.activeBugs}，高优 Bug ${this.summary.urgentBugs}`;
    },
    primaryMetric() {
      if (this.summary.dueToday) return 'todayDue';
      if (this.summary.urgentBugs) return 'urgentBug';
      if (this.summary.activeBugs) return 'webBug';
      if (this.summary.riskTasks) return 'riskTask';
      return 'webBug';
    },
    hasAlerts() {
      return this.summary.total > 0 && this.canViewTasks && this.activeView === 'tasks';
    },
    alertKey() {
      return `${this.todayKey()}-${this.summary.dueToday}-${this.summary.riskTasks}-${this.summary.activeBugs}-${this.summary.urgentBugs}`;
    },
    notificationSupported() {
      return typeof window !== 'undefined' && 'Notification' in window;
    },
    browserNoticeText() {
      if (this.browserNoticeStatus) return this.browserNoticeStatus;
      if (!this.notificationSupported) return '当前浏览器不支持系统通知。';
      if (this.notificationPermission === 'granted') return '浏览器通知已开启，切到其他标签页也能收到提醒。';
      if (this.notificationPermission === 'denied') return '浏览器通知已被拒绝，需要在浏览器地址栏权限里重新允许。';
      return '开启后，即使不盯着平台页面，也能收到系统通知。';
    },
    browserNotificationBody() {
      return this.modalRows.map(row => `${row.label}：${row.value}`).join('，');
    }
  },
  watch: {
    alertKey: {
      immediate: true,
      handler() {
        this.$nextTick(() => this.sendBrowserNotification());
      }
    },
    activeView(value, previous) {
      if (value === previous) return;
      if (value === 'tasks') {
        this.modalDismissed = false;
        this.$nextTick(() => {
          this.sendBrowserNotification();
        });
        return;
      }
      this.modalVisible = false;
      this.drawerVisible = false;
    }
  },
  mounted() {
    localStorage.removeItem('awp-critical-notification-ack');
    this.sendBrowserNotification();
  },
  methods: {
    currentNotificationPermission() {
      if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
      return Notification.permission;
    },
    todayKey() {
      const date = new Date();
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      return `${year}-${month}-${day}`;
    },
    numberMetric(value, fallback = 0) {
      const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(number) ? number : fallback;
    },
    modalMetricPriority(metric) {
      const order = {
        dueToday: 10,
        urgentBugs: 20,
        activeBugs: 30,
        riskTasks: 40
      };
      return order[metric.key] ?? 50;
    },
    isClosedTask(task) {
      return /closed|cancel|cancelled/i.test(task.zentaoStatus || task.zentao?.originalStatus || task.status || '');
    },
    isClosedBug(bug) {
      return /closed|resolved/i.test(bug.status || bug.zentao?.status || '');
    },
    taskAlert(task, badge, tone) {
      return {
        id: `task-${badge}-${task.id || task.taskNo}`,
        type: 'task',
        source: task,
        tone,
        badge,
        owner: task.developer || '未分配',
        title: `#${task.taskNo || task.zentao?.id || '-'} ${task.displayTitle || task.title || '未命名任务'}`,
        meta: `${task.projectName || '-'} · ${this.app.zentaoStatusLabel(task.zentaoStatus || task.zentao?.originalStatus)} · 截止 ${task.deadline || '-'}`
      };
    },
    bugAlert(bug, badge, tone) {
      return {
        id: `bug-${badge}-${bug.id || bug.bugNo}`,
        type: 'bug',
        source: bug,
        tone,
        badge,
        owner: this.app.bugAssigneeName(bug),
        title: `#${bug.bugNo || bug.zentao?.id || '-'} ${bug.displayTitle || bug.title || '未命名 Bug'}`,
        meta: `${bug.projectName || '-'} · ${this.app.bugStatusLabel(bug.status || bug.zentao?.status)} · 截止 ${bug.deadline || '-'}`
      };
    },
    uniqueBugAlerts(alerts = []) {
      const seen = new Set();
      return alerts.filter(alert => {
        const id = alert.source?.bugNo || alert.source?.zentao?.id || alert.id;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },
    maybeOpenModal() {
      if (this.modalDismissed || !this.hasAlerts || !this.alertKey) return;
    },
    async enableBrowserNotification() {
      if (!this.notificationSupported) {
        this.browserNoticeStatus = '当前浏览器不支持系统通知。';
        return;
      }
      this.browserNoticeStatus = '正在请求浏览器通知权限...';
      const permission = await Notification.requestPermission();
      this.notificationPermission = permission;
      if (permission === 'granted') {
        this.browserNoticeStatus = '权限已开启，正在发送测试通知...';
        this.sendBrowserNotification(true);
        return;
      }
      if (permission === 'denied') this.browserNoticeStatus = '通知权限被拒绝，请在浏览器地址栏权限里改为允许。';
      else this.browserNoticeStatus = '还没有授权通知权限，请再次点击并允许通知。';
    },
    sendBrowserNotification(force = false) {
      this.notificationPermission = this.currentNotificationPermission();
      if (!this.notificationSupported) {
        this.browserNoticeStatus = '当前浏览器不支持系统通知。';
        return;
      }
      if (this.notificationPermission !== 'granted') {
        this.browserNoticeStatus = '还没有浏览器通知权限，请先点击开启。';
        return;
      }
      if (!this.hasAlerts || !this.alertKey) {
        this.browserNoticeStatus = '当前没有可发送的高压通知。';
        return;
      }
      if (!force && this.notifiedAlertKey === this.alertKey) return;
      this.notifiedAlertKey = this.alertKey;
      try {
        const notification = new Notification('WEB工作流平台高压通知', {
          body: this.browserNotificationBody || this.subline,
          tag: force ? `awp-critical-notification-test-${Date.now()}` : 'awp-critical-notification',
          requireInteraction: true
        });
        if (force) this.browserNoticeStatus = '测试通知已发送。如果没看到，请检查 macOS 通知中心或浏览器通知权限。';
        notification.onclick = () => {
          window.focus();
          this.goMetric(this.primaryMetric);
          notification.close();
        };
      } catch (error) {
        this.browserNoticeStatus = `发送失败：${error?.message || error}`;
      }
    },
    acknowledge() {
      this.markAcknowledged();
      this.modalVisible = false;
    },
    markAcknowledged() {
      if (!this.alertKey) return;
      this.acknowledgedKey = this.alertKey;
      this.modalDismissed = true;
      localStorage.removeItem('awp-critical-notification-ack');
    },
    openDrawer() {
      this.drawerVisible = true;
    },
    toggleDrawer() {
      this.drawerVisible = !this.drawerVisible;
    },
    goMetric(metric) {
      this.markAcknowledged();
      this.modalVisible = false;
      this.drawerVisible = false;
      this.$nextTick(() => {
        this.app.applyTaskMetricFilter(metric);
        this.app.switchView('tasks');
      });
    },
    openAlert(alert) {
      if (alert.type === 'bug') {
        this.goMetric(alert.badge === '高优 Bug' ? 'urgentBug' : 'webBug');
        return;
      }
      this.goMetric('todayDue');
    }
  }
};
</script>
