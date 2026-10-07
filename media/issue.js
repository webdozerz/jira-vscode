// Скрипт панели задачи: формы внизу страницы, правка своих записей и обмен сообщениями с расширением.
(function () {
  const vscode = acquireVsCodeApi()
  const transitions = JSON.parse(document.body.dataset.transitions || '[]')

  const flash = document.getElementById('flash')
  const errorBox = document.getElementById('error')
  const forms = Array.from(document.querySelectorAll('form[data-form]'))
  const openButtons = Array.from(document.querySelectorAll('[data-open-form]'))

  const TIME_PATTERN = /^(\d+(\.\d+)?\s*[wdhm]\s*)+$/i
  const PREVIEW_DELAY_MS = 600

  let inlineForm = null
  let previewRequestId = 0
  let previewTimer = null

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function nowForInput() {
    const date = new Date()
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  function showError(message) {
    const target = inlineForm ? inlineForm.querySelector('.error') : errorBox
    target.textContent = message
    target.hidden = !message
  }

  function setBusy(container, isBusy) {
    container.querySelectorAll('button, input, textarea, select').forEach((element) => {
      element.disabled = isBusy
    })
  }

  // ----- черновик комментария переживает перезагрузку панели -----

  function saveDraft(value) {
    vscode.setState({ commentDraft: value })
  }

  function loadDraft() {
    const state = vscode.getState()
    return state && typeof state.commentDraft === 'string' ? state.commentDraft : ''
  }

  // ----- нижние формы -----

  function closeForms() {
    forms.forEach((form) => {
      form.hidden = true
    })
    openButtons.forEach((button) => button.classList.remove('is-active'))
    showError('')
  }

  function openForm(name, keepFlash) {
    const form = document.getElementById(`form-${name}`)
    if (!form) {
      return
    }

    const wasOpen = !form.hidden
    closeForms()
    if (wasOpen && !keepFlash) {
      return
    }

    if (!keepFlash) {
      flash.hidden = true
    }
    form.hidden = false
    document.querySelector(`[data-open-form="${name}"]`).classList.add('is-active')

    if (name === 'worklog' && !form.elements.started.value) {
      form.elements.started.value = nowForInput()
    }
    if (name === 'transition') {
      renderTransitionFields(form)
    }

    const firstField = form.querySelector('textarea, input:not([type="checkbox"]), select')
    if (firstField) {
      firstField.focus()
    }
  }

  function renderTransitionFields(form) {
    const container = document.getElementById('transition-fields')
    const select = form.elements.transition
    if (!container || !select) {
      return
    }

    container.replaceChildren()
    const transition = transitions.find((item) => item.id === select.value)
    if (!transition) {
      return
    }

    transition.fields.forEach((field) => {
      const label = document.createElement('label')
      label.textContent = field.name

      const fieldSelect = document.createElement('select')
      fieldSelect.dataset.fieldId = field.id
      field.values.forEach((value) => {
        const option = document.createElement('option')
        option.value = value.id
        option.textContent = value.name
        fieldSelect.append(option)
      })

      label.append(fieldSelect)
      container.append(label)
    })
  }

  function buildPayload(form) {
    const name = form.dataset.form

    if (name === 'comment') {
      const body = form.elements.body.value.trim()
      return body
        ? { type: 'comment', body, markdown: form.elements.markdown.checked }
        : { error: 'Комментарий не может быть пустым' }
    }

    if (name === 'worklog') {
      return worklogPayload('worklog', form)
    }

    const fields = {}
    form.querySelectorAll('[data-field-id]').forEach((select) => {
      fields[select.dataset.fieldId] = select.value
    })
    return { type: 'transition', transitionId: form.elements.transition.value, fields }
  }

  function worklogPayload(type, form, id) {
    const timeSpent = form.elements.timeSpent.value.trim()
    if (!TIME_PATTERN.test(timeSpent)) {
      return { error: 'Время указывайте так: 1h 30m, 45m или 2d' }
    }
    if (!form.elements.started.value) {
      return { error: 'Укажите дату и время начала' }
    }
    return {
      type,
      ...(id ? { id } : {}),
      timeSpent,
      started: form.elements.started.value,
      comment: form.elements.comment.value.trim(),
    }
  }

  // ----- предпросмотр комментария -----

  function requestPreview(form) {
    const preview = form.querySelector('[data-preview]')
    preview.querySelector('[data-preview-body]').textContent = 'Загрузка…'
    previewRequestId += 1
    vscode.postMessage({
      type: 'preview',
      text: form.elements.body.value,
      markdown: form.elements.markdown.checked,
      requestId: previewRequestId,
    })
  }

  function schedulePreview(form) {
    const preview = form.querySelector('[data-preview]')
    if (preview.hidden) {
      return
    }
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => requestPreview(form), PREVIEW_DELAY_MS)
  }

  function togglePreview(form) {
    const preview = form.querySelector('[data-preview]')
    preview.hidden = !preview.hidden
    form.querySelector('[data-toggle-preview]').textContent = preview.hidden ? 'Предпросмотр' : 'Скрыть предпросмотр'
    if (!preview.hidden) {
      requestPreview(form)
    }
  }

  // ----- правка и удаление своих записей -----

  function field(labelText, control) {
    const label = document.createElement('label')
    label.append(labelText, control)
    return label
  }

  function closeInlineForm() {
    if (!inlineForm) {
      return
    }
    const card = inlineForm.closest('.card')
    inlineForm.remove()
    inlineForm = null
    card.querySelectorAll('[data-view], .card__actions').forEach((element) => {
      element.hidden = false
    })
  }

  function buildInlineForm(card, controls, onSubmit) {
    closeInlineForm()

    const form = document.createElement('form')
    form.className = 'form form_inline'
    controls.forEach((control) => form.append(control))

    const actions = document.createElement('div')
    actions.className = 'form__actions'
    const save = document.createElement('button')
    save.type = 'submit'
    save.textContent = 'Сохранить'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'secondary'
    cancel.textContent = 'Отмена'
    cancel.addEventListener('click', closeInlineForm)
    actions.append(save, cancel)

    const error = document.createElement('div')
    error.className = 'error'
    error.hidden = true
    form.append(actions, error)

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      showError('')
      const payload = onSubmit(form)
      if (payload.error) {
        showError(payload.error)
        return
      }
      setBusy(form, true)
      vscode.postMessage(payload)
    })
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target.tagName === 'TEXTAREA') {
        form.requestSubmit()
      }
    })

    card.querySelectorAll('[data-view], .card__actions').forEach((element) => {
      element.hidden = true
    })
    card.append(form)
    inlineForm = form
    form.querySelector('textarea, input').focus()
  }

  function editComment(card) {
    const body = document.createElement('textarea')
    body.name = 'body'
    body.rows = 6
    body.value = card.dataset.raw || ''

    const hint = document.createElement('p')
    hint.className = 'hint'
    hint.textContent = 'Здесь разметка Jira (не Markdown): *жирный*, _курсив_, {{код}}, h2. заголовок.'

    buildInlineForm(card, [body, hint], (form) => {
      const value = form.elements.body.value.trim()
      return value
        ? { type: 'editComment', id: card.dataset.commentId, body: value }
        : { error: 'Комментарий не может быть пустым' }
    })
  }

  function editWorklog(card) {
    const time = document.createElement('input')
    time.name = 'timeSpent'
    time.type = 'text'
    time.autocomplete = 'off'
    time.value = card.dataset.timeSpent || ''

    const started = document.createElement('input')
    started.name = 'started'
    started.type = 'datetime-local'
    started.value = card.dataset.started || ''

    const row = document.createElement('div')
    row.className = 'form__row'
    row.append(field('Время', time), field('Начало', started))

    const comment = document.createElement('textarea')
    comment.name = 'comment'
    comment.rows = 3
    comment.value = card.dataset.comment || ''

    buildInlineForm(card, [row, field('Комментарий', comment)], (form) =>
      worklogPayload('editWorklog', form, card.dataset.worklogId),
    )
  }

  function deleteRecord(card) {
    const isWorklog = Boolean(card.dataset.worklogId)
    setBusy(card, true)
    vscode.postMessage({
      type: isWorklog ? 'deleteWorklog' : 'deleteComment',
      id: isWorklog ? card.dataset.worklogId : card.dataset.commentId,
    })
  }

  // ----- обработчики -----

  openButtons.forEach((button) => {
    button.addEventListener('click', () => openForm(button.dataset.openForm))
  })

  document.querySelectorAll('[data-cancel]').forEach((button) => {
    button.addEventListener('click', closeForms)
  })

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => vscode.postMessage({ type: button.dataset.action }))
  })

  document.querySelectorAll('[data-issue]').forEach((button) => {
    button.addEventListener('click', () => vscode.postMessage({ type: 'openIssue', key: button.dataset.issue }))
  })

  document.querySelectorAll('[data-attachment]').forEach((button) => {
    button.addEventListener('click', () => vscode.postMessage({ type: 'attachment', id: button.dataset.attachment }))
  })
  document.querySelectorAll('[data-attachment-browser]').forEach((button) => {
    button.addEventListener('click', () =>
      vscode.postMessage({ type: 'attachment', id: button.dataset.attachmentBrowser, inBrowser: true }),
    )
  })

  document.querySelectorAll('.card [data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.card')
      return card.dataset.worklogId ? editWorklog(card) : editComment(card)
    })
  })
  document.querySelectorAll('.card [data-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteRecord(button.closest('.card')))
  })

  const transitionSelect = document.querySelector('select[name="transition"]')
  if (transitionSelect) {
    transitionSelect.addEventListener('change', () => renderTransitionFields(transitionSelect.form))
  }

  forms.forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      showError('')

      const payload = buildPayload(form)
      if (payload.error) {
        showError(payload.error)
        return
      }

      if (form.dataset.form === 'comment') {
        saveDraft('')
      }
      setBusy(form, true)
      vscode.postMessage(payload)
    })

    // Ctrl/Cmd+Enter отправляет форму из многострочного поля
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target.tagName === 'TEXTAREA') {
        form.requestSubmit()
      }
    })
  })

  const commentForm = document.getElementById('form-comment')
  if (commentForm) {
    commentForm.querySelector('[data-toggle-preview]').addEventListener('click', () => togglePreview(commentForm))
    commentForm.elements.markdown.addEventListener('change', () => schedulePreview(commentForm))
    commentForm.elements.body.addEventListener('input', () => {
      saveDraft(commentForm.elements.body.value)
      schedulePreview(commentForm)
    })
  }

  window.addEventListener('message', (event) => {
    const message = event.data
    if (!message) {
      return
    }

    if (message.type === 'error' || message.type === 'cancelled') {
      forms.forEach((form) => setBusy(form, false))
      document.querySelectorAll('.card').forEach((card) => setBusy(card, false))
      if (message.type === 'error') {
        showError(message.message)
      }
      return
    }

    if (message.type === 'preview' && message.requestId === previewRequestId && commentForm) {
      commentForm.querySelector('[data-preview-body]').innerHTML = message.html || '<p class="empty">Пока нечего показывать</p>'
      commentForm.querySelector('[data-preview-wiki]').textContent = message.wiki
      return
    }

    if (message.type === 'previewError' && message.requestId === previewRequestId && commentForm) {
      commentForm.querySelector('[data-preview-body]').textContent = `Не удалось построить предпросмотр: ${message.message}`
    }
  })

  // ----- состояние при загрузке -----

  const draft = loadDraft()
  if (commentForm && draft) {
    commentForm.elements.body.value = draft
  }

  const initialForm = document.body.dataset.openForm
  if (initialForm) {
    openForm(initialForm, true)
  } else if (draft) {
    openForm('comment', true)
  }
})()
