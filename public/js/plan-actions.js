/**
 * 计划相关的交互组件。
 * 首页与计划页共用，保证两处行为完全一致。
 */

import { api } from './api.js';
import { openModal, toast, toastError, toastSuccess, esc, todayISO } from './ui.js';
import { refresh } from './router.js';

/** 周期单位中文名 */
export const CYCLE_LABEL = { week: '周', month: '月', year: '年' };

/**
 * 量化计划的"记进度"弹窗。
 * @param {object} opts
 * @param {object} opts.plan 计划状态（含 total/target/unit）
 * @param {string} opts.date
 */
export function openCheckinDialog({ plan, date = todayISO(), onDone }) {
  const isOver = plan.total > plan.target;
  const remain = Math.max(0, plan.target - plan.total);

  return openModal({
    title: `记进度 · ${plan.name}`,
    size: 'narrow',
    body: `
      <div class="flex-between mb-3">
        <span class="text-sm muted">本周期进度</span>
        <span class="text-sm"><strong>${plan.total}</strong> / ${plan.target} ${esc(plan.unit || '')}</span>
      </div>
      <div class="progress-bar mb-3">
        <div class="progress-fill ${isOver ? 'over' : ''}" style="width:${Math.min(100, (plan.ratio || 0) * 100)}%"></div>
      </div>
      <div class="field">
        <label for="checkin-value">本次完成多少${esc(plan.unit || '')}？</label>
        <input class="input" id="checkin-value" type="number" min="0" step="any"
               value="${remain > 0 ? Math.min(remain, plan.target) : 1}" autocomplete="off">
        <span class="hint">可以超过目标值——超额完成会在首页和计划页特别标注。</span>
      </div>
      <div class="quick-values">
        ${[1, 2, 3, 5, 10]
          .map((v) => `<button class="chip" type="button" data-quick="${v}">＋${v}</button>`)
          .join('')}
        <button class="chip" type="button" data-quick="set">改为</button>
      </div>`,
    footer: `
      <button class="btn" data-act="cancel" type="button">取消</button>
      <button class="btn btn-primary" data-act="save" type="button">记下</button>`,
    onMount: ({ body, foot, close }) => {
      const input = body.querySelector('#checkin-value');
      let mode = 'add';

      body.querySelectorAll('[data-quick]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const value = btn.dataset.quick;
          if (value === 'set') {
            mode = 'set';
            input.focus();
            input.select();
            return;
          }
          mode = 'add';
          input.value = value;
          input.focus();
          input.select();
        });
      });

      const submit = async () => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0) {
          toastError('请输入有效数字');
          return;
        }
        try {
          const status = await api.checkin(plan.id, { date, value, mode });
          close();
          const over = status.over;
          toastSuccess(
            over
              ? `记下了，本周期 ${status.total}/${status.target} —— 已超额！`
              : `记下了，本周期 ${status.total}/${status.target}`,
          );
          if (onDone) onDone(status);
          else refresh();
        } catch (err) {
          toastError(err.message);
        }
      };

      foot.querySelector('[data-act="cancel"]').addEventListener('click', close);
      foot.querySelector('[data-act="save"]').addEventListener('click', submit);
      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    },
  });
}

/**
 * 切换确认式计划的打卡状态。
 */
export async function toggleCheckin(plan, date = todayISO(), onDone) {
  try {
    const status = plan.checkToday
      ? await api.uncheckin(plan.id, date)
      : await api.checkin(plan.id, { date });
    if (!plan.checkToday) {
      toastSuccess(status.streak > 1 ? `已打卡 · 连胜 ${status.streak} 天` : '已打卡');
    }
    if (onDone) onDone(status);
    else refresh();
    return status;
  } catch (err) {
    toastError(err.message);
    return null;
  }
}

/**
 * 新建 / 编辑计划。
 * @param {object} opts { plan?: 现有计划, onSaved }
 */
export function openPlanEditor({ plan = null, onSaved } = {}) {
  const editing = !!plan;
  const isQuant = plan ? plan.mode === 'quant' : false;
  const today = todayISO();

  return openModal({
    title: editing ? '编辑计划' : '新建计划',
    body: `
      <div class="field">
        <label for="plan-name">计划名称</label>
        <input class="input" id="plan-name" type="text" placeholder="例如：每周跑 3 次 / 每天背单词"
               value="${esc(plan?.name || '')}" autocomplete="off">
      </div>

      <div class="field">
        <label>打卡方式</label>
        <div class="seg" id="plan-mode">
          <button type="button" data-mode="check" class="${isQuant ? '' : 'active'}">确认式（今天做没做）</button>
          <button type="button" data-mode="quant" class="${isQuant ? 'active' : ''}">量化式（记进度，可超额）</button>
        </div>
      </div>

      <div id="quant-fields" style="${isQuant ? '' : 'display:none'}">
        <div class="row">
          <div class="field">
            <label for="plan-target">周期目标</label>
            <input class="input" id="plan-target" type="number" min="0" step="any"
                   value="${plan?.targetValue ?? 3}" autocomplete="off">
          </div>
          <div class="field">
            <label for="plan-unit">单位</label>
            <input class="input" id="plan-unit" type="text" placeholder="次 / 本 / 公里"
                   value="${esc(plan?.unit || '次')}" autocomplete="off">
          </div>
        </div>
      </div>

      <div class="field">
        <label>周期长度</label>
        <div class="seg" id="plan-cycle">
          ${['week', 'month', 'year']
            .map((u) => {
              const active = (plan?.cycleUnit || 'week') === u;
              return `<button type="button" data-cycle="${u}" class="${active ? 'active' : ''}">每${CYCLE_LABEL[u]}</button>`;
            })
            .join('')}
        </div>
        <span class="hint">采用滚动周期：从起始日往后数，到期自动进入下一周期。</span>
      </div>

      <div class="row">
        <div class="field">
          <label for="plan-start">起始日</label>
          <input class="input" id="plan-start" type="date" value="${plan?.startDate || today}">
        </div>
        <div class="field">
          <label>首次起算</label>
          <div class="seg" id="plan-startmode">
            <button type="button" data-sm="same_day" class="${(plan?.startMode || 'same_day') === 'same_day' ? 'active' : ''}">当天开始</button>
            <button type="button" data-sm="next_day" class="${plan?.startMode === 'next_day' ? 'active' : ''}">次日开始</button>
          </div>
        </div>
      </div>`,
    footer: `
      <button class="btn" data-act="cancel" type="button">取消</button>
      <button class="btn btn-primary" data-act="save" type="button">${editing ? '保存修改' : '创建计划'}</button>`,
    onMount: ({ body, foot, close }) => {
      let mode = isQuant ? 'quant' : 'check';
      let cycleUnit = plan?.cycleUnit || 'week';
      let startMode = plan?.startMode || 'same_day';

      const quantFields = body.querySelector('#quant-fields');

      // 打卡方式
      body.querySelectorAll('#plan-mode button').forEach((btn) => {
        btn.addEventListener('click', () => {
          mode = btn.dataset.mode;
          body.querySelectorAll('#plan-mode button').forEach((b) => b.classList.toggle('active', b === btn));
          quantFields.style.display = mode === 'quant' ? '' : 'none';
        });
      });

      // 周期长度
      body.querySelectorAll('#plan-cycle button').forEach((btn) => {
        btn.addEventListener('click', () => {
          cycleUnit = btn.dataset.cycle;
          body
            .querySelectorAll('#plan-cycle button')
            .forEach((b) => b.classList.toggle('active', b === btn));
        });
      });

      // 首次起算
      body.querySelectorAll('#plan-startmode button').forEach((btn) => {
        btn.addEventListener('click', () => {
          startMode = btn.dataset.sm;
          body
            .querySelectorAll('#plan-startmode button')
            .forEach((b) => b.classList.toggle('active', b === btn));
          // 选"次日开始"时，若起始日还是今天，自动顺延，减少一次手动操作
          const startInput = body.querySelector('#plan-start');
          if (startMode === 'next_day' && startInput.value === today) {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            const pad = (n) => String(n).padStart(2, '0');
            startInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          }
        });
      });

      const submit = async () => {
        const name = body.querySelector('#plan-name').value.trim();
        if (!name) {
          toastError('请填写计划名称');
          return;
        }
        const payload = {
          name,
          mode,
          cycleUnit,
          startDate: body.querySelector('#plan-start').value,
          startMode,
        };
        if (mode === 'quant') {
          payload.targetValue = Number(body.querySelector('#plan-target').value);
          payload.unit = body.querySelector('#plan-unit').value.trim() || '次';
          if (!Number.isFinite(payload.targetValue) || payload.targetValue <= 0) {
            toastError('请输入大于 0 的周期目标');
            return;
          }
        }

        try {
          const saved = editing
            ? await api.updatePlan(plan.id, payload)
            : await api.createPlan(payload);
          close();
          toastSuccess(editing ? '已保存修改' : '计划已创建');
          if (onSaved) onSaved(saved);
          else refresh();
        } catch (err) {
          toastError(err.message);
        }
      };

      foot.querySelector('[data-act="cancel"]').addEventListener('click', close);
      foot.querySelector('[data-act="save"]').addEventListener('click', submit);
    },
  });
}

/**
 * 查看某个计划的历史打卡记录。
 */
export async function openPlanHistory({ planId, date = todayISO() }) {
  let data;
  try {
    data = await api.planHistory(planId, date);
  } catch (err) {
    toastError(err.message);
    return;
  }
  const { plan, checkins, status } = data;

  const rows = checkins.length
    ? [...checkins]
        .reverse()
        .map((c) => {
          const result =
            plan.mode === 'quant'
              ? `<span class="v">${c.value} ${esc(plan.unit || '')}</span>`
              : c.done
                ? '<span class="tag tag-success">已完成</span>'
                : '<span class="tag">未完成</span>';
          return `<div class="kv"><span class="k">${esc(c.date)}</span>${result}</div>`;
        })
        .join('')
    : '<p class="text-sm muted">还没有打卡记录。</p>';

  openModal({
    title: `打卡记录 · ${plan.name}`,
    body: `
      <div class="card mb-3" style="background:var(--surface-2);border:0">
        <div class="kv"><span class="k">打卡方式</span><span class="v">${plan.mode === 'quant' ? '量化式' : '确认式'}</span></div>
        ${plan.mode === 'quant' ? `<div class="kv"><span class="k">周期目标</span><span class="v">${plan.targetValue} ${esc(plan.unit || '')}</span></div>` : ''}
        <div class="kv"><span class="k">周期长度</span><span class="v">每${CYCLE_LABEL[plan.cycleUnit]}</span></div>
        <div class="kv"><span class="k">起始日</span><span class="v">${esc(plan.startDate)}</span></div>
        ${status?.period ? `<div class="kv"><span class="k">本周期</span><span class="v">${esc(status.period.startISO)} → ${esc(status.period.endISO)}</span></div>` : ''}
        ${status?.mode === 'quant' ? `<div class="kv"><span class="k">本周期进度</span><span class="v">${status.total} / ${status.target} ${esc(status.unit || '')}</span></div>` : ''}
      </div>
      <div class="section-title mb-3">全部记录 <span class="count">${checkins.length} 条</span></div>
      <div class="backup-list">${rows}</div>`,
    size: 'narrow',
  });
}
