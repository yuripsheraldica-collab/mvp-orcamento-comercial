/* ==========================================================
   JAVASCRIPT - PORTAL DE PROPOSTAS GRUPO CIPRIANO AYALA
   ========================================================== */

(function () {
  'use strict';

  // Configurações e Chaves do Sistema
  const GRUPO_CNPJ_OFICIAL = "12.345.678/0001-90";
  const DB_PROPOSTAS_KEY = "ca_propostas_db";
  const DB_SESSION_KEY = "ca_comercial_session";

  // Helper de codificação/decodificação Base64 com suporte a UTF-8
  function encodeProposal(proposal) {
    const jsonStr = JSON.stringify(proposal);
    const bytes = new TextEncoder().encode(jsonStr);
    let binString = "";
    for (let i = 0; i < bytes.length; i++) {
      binString += String.fromCharCode(bytes[i]);
    }
    return btoa(binString);
  }

  function decodeProposal(base64Str) {
    try {
      const binString = atob(base64Str);
      const bytes = new Uint8Array(binString.length);
      for (let i = 0; i < binString.length; i++) {
        bytes[i] = binString.charCodeAt(i);
      }
      const jsonStr = new TextDecoder().decode(bytes);
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("Erro ao decodificar proposta:", e);
      return null;
    }
  }

  // Estado Local da Aplicação
  let state = {
    currentView: 'login',
    propostas: [],
    session: null,
    editingProposalId: null, // null se for criação nova
    activeServices: []      // Itens do formulário atual
  };

  // ==========================================
  // 1. BANCO DE DADOS (LOCALSTORAGE)
  // ==========================================
  const db = {
    init() {
      // Carregar propostas
      const raw = localStorage.getItem(DB_PROPOSTAS_KEY);
      state.propostas = raw ? JSON.parse(raw) : [];
      
      // Carregar sessão comercial
      const sessionRaw = sessionStorage.getItem(DB_SESSION_KEY);
      state.session = sessionRaw ? JSON.parse(sessionRaw) : null;
    },
    
    saveProposal(prop) {
      const idx = state.propostas.findIndex(p => p.id === prop.id);
      if (idx !== -1) {
        state.propostas[idx] = prop; // Atualizar
      } else {
        state.propostas.push(prop); // Criar novo
      }
      localStorage.setItem(DB_PROPOSTAS_KEY, JSON.stringify(state.propostas));
      ui.renderProposalList();
    },
    
    getProposal(id) {
      return state.propostas.find(p => p.id === id) || null;
    },
    
    clear() {
      localStorage.removeItem(DB_PROPOSTAS_KEY);
      sessionStorage.removeItem(DB_SESSION_KEY);
      state.propostas = [];
      state.session = null;
      state.editingProposalId = null;
      state.activeServices = [];
      window.location.href = window.location.pathname; // Recarrega limpo
    }
  };

  // ==========================================
  // 2. ROTEADOR
  // ==========================================
  const router = {
    init() {
      window.addEventListener('popstate', router.handleRoute);
      router.handleRoute();
    },
    
    handleRoute() {
      db.init();
      const params = new URLSearchParams(window.location.search);
      const pData = params.get('p_data');
      const propostaId = params.get('proposta');
      
      if (pData) {
        const prop = decodeProposal(pData);
        if (prop) {
          // Importa/atualiza no banco de dados local para aparecer na lista do CRM
          db.saveProposal(prop);
          router.navigate('cliente', prop);
        } else {
          alert('Erro ao carregar a proposta a partir do link.');
          router.navigate('login');
        }
      } else if (propostaId) {
        const prop = db.getProposal(propostaId);
        if (prop) {
          router.navigate('cliente', prop);
        } else {
          alert('Proposta não localizada no banco de dados local.');
          router.navigate('login');
        }
      } else {
        if (state.session) {
          router.navigate('comercial');
        } else {
          router.navigate('login');
        }
      }
    },
    
    navigate(view, data = null) {
      state.currentView = view;
      
      // Controlar telas ativas
      document.querySelectorAll('.view-section').forEach(sec => {
        if (sec.dataset.view === view) {
          sec.classList.add('active');
        } else {
          sec.classList.remove('active');
        }
      });
      
      // Resetar classes do body para temas específicos
      const body = document.getElementById('body-root');
      if (view === 'cliente') {
        body.className = ''; // Limpa tema escuro global para a proposta
      } else {
        body.className = 'theme-dark'; // Mantém tema escuro no comercial/login
      }
      
      // Lógica específica para carregar dados nas visões
      if (view === 'comercial') {
        ui.initCommercialView();
      } else if (view === 'cliente' && data) {
        ui.loadClientView(data);
      }
      
      ui.updateHomologationPanel();
    }
  };

  // ==========================================
  // 3. INTERFACE DE USUÁRIO (UI)
  // ==========================================
  const ui = {
    init() {
      // Elementos do Login
      document.getElementById('login-form').addEventListener('submit', ui.handleLogin);
      document.getElementById('btn-quick-login').addEventListener('click', ui.handleQuickLogin);
      document.getElementById('btn-logout').addEventListener('click', ui.handleLogout);
      
      // Máscaras e validações nos inputs
      ui.setupMasks();
      
      // Botão Buscar CNPJ Cliente
      document.getElementById('btn-fetch-cnpj').addEventListener('click', ui.handleFetchCnpj);
      
      // Serviços dinâmicos
      document.getElementById('btn-add-service').addEventListener('click', () => {
        ui.addServiceRow();
      });
      
      // Evento de submit do formulário de proposta
      document.getElementById('proposal-form').addEventListener('submit', ui.handleSubmitProposal);
      document.getElementById('btn-cancel-proposal').addEventListener('click', ui.clearProposalForm);
      
      // Modais
      document.getElementById('btn-close-modal').addEventListener('click', ui.closeSuccessModal);
      document.getElementById('btn-copy-link').addEventListener('click', ui.copyProposalLink);
      document.getElementById('btn-share-whatsapp').addEventListener('click', ui.shareProposalWhatsapp);
      
      // Pesquisa lateral no painel comercial
      document.getElementById('search-proposals').addEventListener('input', ui.filterProposalList);
      
      // Ações do Cliente na Proposta
      document.getElementById('btn-print-pdf').addEventListener('click', () => window.print());
      document.getElementById('btn-back-to-admin').addEventListener('click', () => {
        // Remove query parameter e navega para comercial
        window.history.pushState({}, '', window.location.pathname);
        router.handleRoute();
      });
      
      // Configurar Canvas de Assinatura
      signaturePad.init();
      
      // Homologação
      ui.setupHomologationEvents();
    },

    setupMasks() {
      const formatCNPJ = (val) => {
        return val.replace(/\D/g, '')
                  .replace(/^(\d{2})(\d)/, '$1.$2')
                  .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
                  .replace(/\.(\d{3})(\d)/, '.$1/$2')
                  .replace(/(\d{4})(\d)/, '$1-$2')
                  .substring(0, 18);
      };

      const formatCPF = (val) => {
        return val.replace(/\D/g, '')
                  .replace(/(\d{3})(\d)/, '$1.$2')
                  .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
                  .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1-$2')
                  .substring(0, 14);
      };

      const formatPhone = (val) => {
        val = val.replace(/\D/g, '');
        if (val.length > 10) {
          return val.replace(/^(\d{2})(\d{5})(\d{4})/, '($1) $2-$3').substring(0, 15);
        } else {
          return val.replace(/^(\d{2})(\d{4})(\d{4})/, '($1) $2-$3').substring(0, 14);
        }
      };

      // Aplicar nos inputs de CNPJ
      ['login-cnpj', 'client-cnpj'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('input', (e) => {
          e.target.value = formatCNPJ(e.target.value);
        });
      });

      // CPF
      document.getElementById('sign-client-cpf').addEventListener('input', (e) => {
        e.target.value = formatCPF(e.target.value);
      });

      // Telefones
      ['rep-phone', 'rep-whatsapp'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('input', (e) => {
          e.target.value = formatPhone(e.target.value);
        });
      });
    },
    
    handleLogin(e) {
      e.preventDefault();
      const cnpjInput = document.getElementById('login-cnpj').value;
      const cleanCnpj = cnpjInput.replace(/\D/g, '');
      
      if (cleanCnpj.length !== 14) {
        alert("Por favor, insira um CNPJ válido com 14 dígitos.");
        return;
      }
      
      // Salva sessão simulada
      state.session = { cnpj: cnpjInput, loggedAt: new Date().toISOString() };
      sessionStorage.setItem(DB_SESSION_KEY, JSON.stringify(state.session));
      router.navigate('comercial');
    },
    
    handleQuickLogin() {
      document.getElementById('login-cnpj').value = GRUPO_CNPJ_OFICIAL;
      state.session = { cnpj: GRUPO_CNPJ_OFICIAL, loggedAt: new Date().toISOString() };
      sessionStorage.setItem(DB_SESSION_KEY, JSON.stringify(state.session));
      router.navigate('comercial');
    },
    
    handleLogout() {
      sessionStorage.removeItem(DB_SESSION_KEY);
      state.session = null;
      router.navigate('login');
    },
    
    initCommercialView() {
      // Garantir dados na lista lateral
      ui.renderProposalList();
      
      // Se não estiver editando nada ativo, limpar o formulário para criação nova
      if (!state.editingProposalId) {
        ui.clearProposalForm();
      }
    },
    
    // Consulta CNPJ via BrasilAPI
    async handleFetchCnpj() {
      const cnpjField = document.getElementById('client-cnpj');
      const cleanCnpj = cnpjField.value.replace(/\D/g, '');
      
      if (cleanCnpj.length !== 14) {
        alert("Por favor, digite um CNPJ completo para realizar a busca.");
        return;
      }
      
      const btn = document.getElementById('btn-fetch-cnpj');
      const originalText = btn.textContent;
      btn.textContent = "Buscando...";
      btn.disabled = true;
      
      try {
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
        if (!response.ok) {
          throw new Error("Erro na consulta da API");
        }
        
        const data = await response.json();
        
        // Auto-preencher dados
        document.getElementById('client-name').value = data.razao_social || '';
        document.getElementById('client-trade-name').value = data.nome_fantasia || '';
        document.getElementById('client-cep').value = data.cep ? data.cep.replace(/^(\d{5})(\d{3})/, '$1-$2') : '';
        document.getElementById('client-address').value = `${data.descricao_tipo_de_logradouro || ''} ${data.logradouro || ''}`.trim();
        document.getElementById('client-number').value = data.numero || '';
        document.getElementById('client-complement').value = data.complemento || '';
        document.getElementById('client-neighborhood').value = data.bairro || '';
        document.getElementById('client-city').value = data.municipio || '';
        document.getElementById('client-state').value = data.uf || '';
        
      } catch (err) {
        console.error(err);
        alert("Não foi possível carregar os dados automaticamente da Receita Federal. Você pode continuar preenchendo os dados do cliente manualmente.");
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    },
    
    // Gerenciador de itens de serviço
    renderServiceRows() {
      const tbody = document.getElementById('services-tbody');
      tbody.innerHTML = '';
      
      if (state.activeServices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color: var(--text-muted);">Adicione pelo menos um serviço para a proposta.</td></tr>`;
        ui.recalculateTotals();
        return;
      }
      
      state.activeServices.forEach((service, index) => {
        const tr = document.createElement('tr');
        
        // Colunas
        tr.innerHTML = `
          <td>
            <input type="text" value="${service.desc}" placeholder="Descrição do serviço contratado" class="inp-desc" required>
          </td>
          <td>
            <input type="number" value="${service.unitPrice}" step="0.01" min="0" placeholder="0.00" class="inp-price text-right" required>
          </td>
          <td>
            <input type="number" value="${service.qty}" min="1" placeholder="1" class="inp-qty text-center" required>
          </td>
          <td class="col-total text-right font-bold">
            ${ui.formatCurrency(service.unitPrice * service.qty)}
          </td>
          <td class="comissao-column">
            <input type="number" value="${service.commission}" min="0" max="100" step="0.1" placeholder="0" class="inp-comm text-center" required>
          </td>
          <td class="text-center">
            <button type="button" class="btn btn-outline btn-xs btn-remove-service" style="color: var(--color-danger); border-color: rgba(239, 68, 68, 0.2)">
              Excluir
            </button>
          </td>
        `;
        
        // Event listeners para mudanças
        tr.querySelector('.inp-desc').addEventListener('input', (e) => {
          state.activeServices[index].desc = e.target.value;
        });
        
        tr.querySelector('.inp-price').addEventListener('input', (e) => {
          state.activeServices[index].unitPrice = parseFloat(e.target.value) || 0;
          tr.querySelector('.col-total').textContent = ui.formatCurrency(state.activeServices[index].unitPrice * state.activeServices[index].qty);
          ui.recalculateTotals();
        });
        
        tr.querySelector('.inp-qty').addEventListener('input', (e) => {
          state.activeServices[index].qty = parseInt(e.target.value) || 1;
          tr.querySelector('.col-total').textContent = ui.formatCurrency(state.activeServices[index].unitPrice * state.activeServices[index].qty);
          ui.recalculateTotals();
        });
        
        tr.querySelector('.inp-comm').addEventListener('input', (e) => {
          state.activeServices[index].commission = parseFloat(e.target.value) || 0;
          ui.recalculateTotals();
        });
        
        tr.querySelector('.btn-remove-service').addEventListener('click', () => {
          ui.removeServiceRow(index);
        });
        
        tbody.appendChild(tr);
      });
      
      ui.recalculateTotals();
    },
    
    addServiceRow(desc = "", price = 0, qty = 1, comm = 0) {
      state.activeServices.push({ desc, unitPrice: price, qty, commission: comm });
      ui.renderServiceRows();
    },
    
    removeServiceRow(index) {
      state.activeServices.splice(index, 1);
      ui.renderServiceRows();
    },
    
    recalculateTotals() {
      let totalGross = 0;
      let totalCommission = 0;
      
      state.activeServices.forEach(item => {
        const itemGross = item.unitPrice * item.qty;
        const itemComm = itemGross * (item.commission / 100);
        
        totalGross += itemGross;
        totalCommission += itemComm;
      });
      
      const totalNet = totalGross - totalCommission;
      
      // Atualizar labels na tela comercial
      document.getElementById('lbl-total-gross').textContent = ui.formatCurrency(totalGross);
      document.getElementById('lbl-total-commission').textContent = ui.formatCurrency(totalCommission);
      document.getElementById('lbl-total-net').textContent = ui.formatCurrency(totalNet);
      
      return { totalGross, totalCommission, totalNet };
    },
    
    formatCurrency(val) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    },
    
    formatDate(isoString) {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    },
    
    // Envio do formulário de propostas
    handleSubmitProposal(e) {
      e.preventDefault();
      
      if (state.activeServices.length === 0) {
        alert("Por favor, adicione pelo menos um serviço antes de disponibilizar a proposta.");
        return;
      }
      
      const totals = ui.recalculateTotals();
      
      // Gerar ou carregar ID
      let proposalId = state.editingProposalId;
      let status = "Pendente";
      let signatureData = null;
      
      if (!proposalId) {
        proposalId = `CA-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      } else {
        // Manter status e assinatura caso já existam em edição
        const existing = db.getProposal(proposalId);
        if (existing) {
          status = existing.status;
          signatureData = existing.signatureData;
        }
      }
      
      const proposalObj = {
        id: proposalId,
        createdAt: new Date().toISOString(),
        status: status,
        signatureData: signatureData,
        client: {
          cnpj: document.getElementById('client-cnpj').value,
          name: document.getElementById('client-name').value,
          tradeName: document.getElementById('client-trade-name').value,
          cep: document.getElementById('client-cep').value,
          address: document.getElementById('client-address').value,
          number: document.getElementById('client-number').value,
          complement: document.getElementById('client-complement').value,
          neighborhood: document.getElementById('client-neighborhood').value,
          city: document.getElementById('client-city').value,
          state: document.getElementById('client-state').value,
        },
        rep: {
          name: document.getElementById('rep-name').value,
          role: document.getElementById('rep-role').value,
          email: document.getElementById('rep-email').value,
          phone: document.getElementById('rep-phone').value,
          whatsapp: document.getElementById('rep-whatsapp').value,
        },
        services: state.activeServices,
        financial: {
          totalGross: totals.totalGross,
          totalCommission: totals.totalCommission,
          totalNet: totals.totalNet,
          paymentTerms: document.getElementById('payment-terms').value,
          validityDays: parseInt(document.getElementById('proposal-validity').value) || 15
        }
      };
      
      // Salvar proposta no banco
      db.saveProposal(proposalObj);
      
      // Limpar formulário de edição
      state.editingProposalId = null;
      
      // Mostrar Modal de Sucesso
      ui.openSuccessModal(proposalId, proposalObj);
    },
    
    openSuccessModal(id, propObj) {
      const modal = document.getElementById('modal-success');
      const pDataBase64 = encodeProposal(propObj);
      const link = `${window.location.origin}${window.location.pathname}?p_data=${pDataBase64}`;
      
      document.getElementById('share-link-input').value = link;
      modal.classList.add('active');
      
      // Atualizar o botão de visualizar no painel de homologação
      const viewBtn = document.getElementById('h-btn-view-client');
      viewBtn.disabled = false;
      viewBtn.dataset.propId = id;
      viewBtn.dataset.pData = pDataBase64;
    },
    
    closeSuccessModal() {
      document.getElementById('modal-success').classList.remove('active');
      ui.clearProposalForm();
      ui.renderProposalList();
    },
    
    copyProposalLink() {
      const input = document.getElementById('share-link-input');
      input.select();
      input.setSelectionRange(0, 99999); // Mobile
      navigator.clipboard.writeText(input.value);
      
      const copyBtn = document.getElementById('btn-copy-link');
      const originalText = copyBtn.textContent;
      copyBtn.textContent = "Copiado!";
      copyBtn.classList.remove('btn-accent');
      copyBtn.classList.add('btn-primary');
      
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.classList.remove('btn-primary');
        copyBtn.classList.add('btn-accent');
      }, 2000);
    },
    
    shareProposalWhatsapp() {
      const link = document.getElementById('share-link-input').value;
      const cnpj = document.getElementById('client-cnpj').value;
      
      // Localizar dados da proposta gerada no formulário para preencher mensagem
      const repName = document.getElementById('rep-name').value;
      const clientName = document.getElementById('client-name').value;
      const rawWhatsApp = document.getElementById('rep-whatsapp').value;
      const cleanWhatsApp = rawWhatsApp.replace(/\D/g, '');
      
      const msg = `Olá, *${repName}*!\n\nA proposta comercial customizada para a empresa *${clientName}* foi gerada eletronicamente pelo *Grupo Cipriano Ayala*.\n\nVocê pode visualizá-la, realizar o aceite e assinar digitalmente diretamente no link abaixo:\n\n🔗 ${link}\n\nFicamos à inteira disposição para eventuais dúvidas.`;
      
      const waUrl = `https://api.whatsapp.com/send?phone=55${cleanWhatsApp}&text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');
    },
    
    clearProposalForm() {
      state.editingProposalId = null;
      document.getElementById('form-title').textContent = "Nova Proposta Comercial";
      
      document.getElementById('proposal-form').reset();
      state.activeServices = [];
      ui.renderServiceRows();
      
      // Deselecionar itens na lista lateral
      document.querySelectorAll('.proposal-item').forEach(el => el.classList.remove('active'));
    },
    
    // Renderiza a lista lateral no painel comercial
    renderProposalList() {
      const container = document.getElementById('lst-proposals');
      const search = document.getElementById('search-proposals').value.toLowerCase();
      
      const filtered = state.propostas.filter(p => {
        return p.client.name.toLowerCase().includes(search) || 
               p.id.toLowerCase().includes(search) ||
               (p.client.tradeName && p.client.tradeName.toLowerCase().includes(search));
      });
      
      // Atualizar contador
      document.getElementById('lbl-proposal-count').textContent = filtered.length;
      
      container.innerHTML = '';
      
      if (filtered.length === 0) {
        container.innerHTML = `<div class="list-empty">Nenhuma proposta localizada.</div>`;
        return;
      }
      
      // Ordenar por criação recente
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      filtered.forEach(p => {
        const item = document.createElement('div');
        item.className = `proposal-item ${state.editingProposalId === p.id ? 'active' : ''}`;
        
        const statusClass = p.status === 'Aceito' ? 'badge-accepted' : 'badge-pending';
        const dateStr = new Date(p.createdAt).toLocaleDateString('pt-BR');
        
        item.innerHTML = `
          <div class="proposal-item-header">
            <span class="proposal-item-id">${p.id}</span>
            <span class="badge ${statusClass}">${p.status}</span>
          </div>
          <div class="proposal-item-client">${p.client.tradeName || p.client.name}</div>
          <div class="proposal-item-footer">
            <span>${dateStr}</span>
            <span class="proposal-item-value">${ui.formatCurrency(p.financial.totalGross)}</span>
          </div>
        `;
        
        item.addEventListener('click', () => {
          ui.loadProposalIntoEditor(p);
        });
        
        container.appendChild(item);
      });
    },
    
    filterProposalList() {
      ui.renderProposalList();
    },
    
    loadProposalIntoEditor(p) {
      state.editingProposalId = p.id;
      document.getElementById('form-title').textContent = `Editando Proposta ${p.id}`;
      
      // Preencher campos
      document.getElementById('client-cnpj').value = p.client.cnpj;
      document.getElementById('client-name').value = p.client.name;
      document.getElementById('client-trade-name').value = p.client.tradeName || '';
      document.getElementById('client-cep').value = p.client.cep || '';
      document.getElementById('client-address').value = p.client.address || '';
      document.getElementById('client-number').value = p.client.number || '';
      document.getElementById('client-complement').value = p.client.complement || '';
      document.getElementById('client-neighborhood').value = p.client.neighborhood || '';
      document.getElementById('client-city').value = p.client.city || '';
      document.getElementById('client-state').value = p.client.state || '';
      
      document.getElementById('rep-name').value = p.rep.name;
      document.getElementById('rep-role').value = p.rep.role;
      document.getElementById('rep-email').value = p.rep.email;
      document.getElementById('rep-phone').value = p.rep.phone || '';
      document.getElementById('rep-whatsapp').value = p.rep.whatsapp;
      
      document.getElementById('payment-terms').value = p.financial.paymentTerms;
      document.getElementById('proposal-validity').value = p.financial.validityDays;
      
      // Carregar itens de serviço
      state.activeServices = JSON.parse(JSON.stringify(p.services)); // clone profundo
      ui.renderServiceRows();
      
      // Marcar item ativo na lista
      document.querySelectorAll('.proposal-item').forEach(el => el.classList.remove('active'));
      ui.renderProposalList();
      
      // Habilitar botão do cliente no painel de homologação para esta proposta
      const viewBtn = document.getElementById('h-btn-view-client');
      viewBtn.disabled = false;
      viewBtn.dataset.propId = p.id;
    },
    
    // ==========================================
    // CARREGAMENTO DA VISÃO DO CLIENTE
    // ==========================================
    loadClientView(prop) {
      // Ajustar se botão de retorno para comercial deve aparecer (se logado)
      const btnBack = document.getElementById('btn-back-to-admin');
      if (state.session) {
        btnBack.classList.remove('hidden');
      } else {
        btnBack.classList.add('hidden');
      }
      
      // Cabeçalho e Meta dados
      document.getElementById('client-view-prop-id').textContent = prop.id;
      document.getElementById('client-view-prop-date').textContent = new Date(prop.createdAt).toLocaleDateString('pt-BR');
      document.getElementById('client-view-prop-validity').textContent = `${prop.financial.validityDays} dias`;
      
      // Status Badge
      const statusBadge = document.getElementById('client-view-prop-status');
      statusBadge.textContent = prop.status;
      statusBadge.className = 'badge ' + (prop.status === 'Aceito' ? 'badge-accepted' : 'badge-pending');
      
      // Informações das partes
      document.getElementById('client-view-company-name').textContent = prop.client.name.toUpperCase();
      document.getElementById('client-view-company-cnpj').textContent = `CNPJ: ${prop.client.cnpj}`;
      
      const compAddress = `${prop.client.address || ''}, ${prop.client.number || ''} ${prop.client.complement ? '- ' + prop.client.complement : ''} \n ${prop.client.neighborhood || ''} - ${prop.client.city || ''}/${prop.client.state || ''} - CEP: ${prop.client.cep || ''}`;
      document.getElementById('client-view-company-address').textContent = compAddress;
      document.getElementById('client-view-company-rep').textContent = `A/C: ${prop.rep.name} (${prop.rep.role})`;
      
      // Renderizar serviços (OCULTANDO COMISSÃO)
      const servList = document.getElementById('client-view-services-list');
      servList.innerHTML = '';
      
      prop.services.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${item.desc}</strong></td>
          <td class="text-center">${item.qty}</td>
          <td class="text-right">${ui.formatCurrency(item.unitPrice)}</td>
          <td class="text-right font-bold">${ui.formatCurrency(item.unitPrice * item.qty)}</td>
        `;
        servList.appendChild(tr);
      });
      
      // Totais e condições financeiras
      document.getElementById('client-view-total-investment').textContent = ui.formatCurrency(prop.financial.totalGross);
      document.getElementById('client-view-payment-terms').textContent = prop.financial.paymentTerms;
      document.getElementById('client-view-validity-days').textContent = prop.financial.validityDays;
      
      // Configurar tela de assinaturas dependendo do status
      const signInputArea = document.getElementById('signature-input-area');
      const signReceiptArea = document.getElementById('signature-receipt-area');
      
      if (prop.status === 'Aceito' && prop.signatureData) {
        signInputArea.classList.add('hidden');
        signReceiptArea.classList.remove('hidden');
        
        document.getElementById('lbl-receipt-date').textContent = `Assinado em ${ui.formatDate(prop.signatureData.signedAt)}`;
        document.getElementById('lbl-receipt-name').textContent = prop.signatureData.signerName;
        document.getElementById('lbl-receipt-cpf').textContent = prop.signatureData.signerCpf;
        document.getElementById('signature-img-preview').src = prop.signatureData.signatureImg;
      } else {
        signInputArea.classList.remove('hidden');
        signReceiptArea.classList.add('hidden');
        
        // Limpar inputs de assinatura
        document.getElementById('sign-client-name').value = prop.rep.name; // pré-preenche com representante
        document.getElementById('sign-client-cpf').value = '';
        document.getElementById('chk-accept-terms').checked = false;
        signaturePad.clear();
      }
      
      // Configurar botão de whatsapp para contato cliente -> comercial
      const btnContact = document.getElementById('btn-client-contact');
      const msgClient = `Olá! Estou analisando a Proposta Comercial *${prop.id}* do Grupo Cipriano Ayala e gostaria de tirar algumas dúvidas.`;
      btnContact.onclick = () => {
        const cleanRepWa = prop.rep.whatsapp.replace(/\D/g, '');
        window.open(`https://api.whatsapp.com/send?phone=55${cleanRepWa}&text=${encodeURIComponent(msgClient)}`, '_blank');
      };

      // Configurar botão de enviar comprovante de assinatura de volta ao comercial
      const btnShareBack = document.getElementById('btn-client-share-back');
      if (prop.status === 'Aceito') {
        btnShareBack.onclick = () => {
          const pDataBase64 = encodeProposal(prop);
          const link = `${window.location.origin}${window.location.pathname}?p_data=${pDataBase64}`;
          const cleanRepWa = prop.rep.whatsapp.replace(/\D/g, '');
          const msgClientSigned = `Olá! Acabei de assinar eletronicamente a Proposta Comercial *${prop.id}* da empresa *${prop.client.name}*.\n\nAqui está o link de acesso com o comprovante assinado:\n\n🔗 ${link}`;
          window.open(`https://api.whatsapp.com/send?phone=55${cleanRepWa}&text=${encodeURIComponent(msgClientSigned)}`, '_blank');
        };
      }
    },

    // ==========================================
    // SISTEMA DE HOMOLOGAÇÃO / FERRAMENTAS
    // ==========================================
    setupHomologationEvents() {
      // Toggle minimizar
      const panel = document.getElementById('homologation-tools');
      document.getElementById('btn-toggle-homologation').addEventListener('click', () => {
        panel.classList.toggle('collapsed');
      });
      
      // Login Comercial Rápido
      document.getElementById('h-btn-login').addEventListener('click', () => {
        ui.handleQuickLogin();
      });
      
      // Preencher formulário com proposta fake completa
      document.getElementById('h-btn-fill').addEventListener('click', () => {
        if (!state.session) {
          ui.handleQuickLogin();
        }
        
        // CNPJ Real do Google Brasil para teste de busca
        document.getElementById('client-cnpj').value = "19.131.243/0001-97";
        document.getElementById('client-name').value = "GOOGLE BRASIL INTERNET LTDA.";
        document.getElementById('client-trade-name').value = "Google";
        document.getElementById('client-cep').value = "04538-133";
        document.getElementById('client-address').value = "Avenida Brigadeiro Faria Lima";
        document.getElementById('client-number').value = "3477";
        document.getElementById('client-complement').value = "Edifício Pátio Victor Malzoni - 18º andar";
        document.getElementById('client-neighborhood').value = "Itaim Bibi";
        document.getElementById('client-city').value = "São Paulo";
        document.getElementById('client-state').value = "SP";
        
        // Responsável
        document.getElementById('rep-name').value = "Carlos Cipriano Ayala";
        document.getElementById('rep-role').value = "Diretor Executivo";
        document.getElementById('rep-email').value = "carlos@ciprianoayala.com";
        document.getElementById('rep-phone').value = "(11) 3224-5000";
        document.getElementById('rep-whatsapp').value = "(11) 98888-7777";
        
        // Serviços
        state.activeServices = [
          { desc: "Assessoria Aduaneira e Comércio Exterior", unitPrice: 4500.00, qty: 1, commission: 8.0 },
          { desc: "Operação Logística de Importação (Container Fechado)", unitPrice: 12000.00, qty: 2, commission: 5.0 },
          { desc: "Análise de Viabilidade Tributária Comercial", unitPrice: 3500.00, qty: 1, commission: 10.0 }
        ];
        
        // Fechamento
        document.getElementById('payment-terms').value = "Faturamento quinzenal em 15 ddl. Nota Fiscal de Serviço eletrônica (NFs-e) via boleto bancário.";
        document.getElementById('proposal-validity').value = "20";
        
        ui.renderServiceRows();
        
        // Rolar tela para a área de serviços
        document.querySelector('.dashboard-content').scrollTop = 300;
      });
      
      // Navegar para proposta ativa de teste
      document.getElementById('h-btn-view-client').onclick = (e) => {
        const id = e.target.dataset.propId;
        const pData = e.target.dataset.pData;
        if (pData) {
          window.history.pushState({}, '', `${window.location.pathname}?p_data=${pData}`);
          router.handleRoute();
        } else if (id) {
          window.history.pushState({}, '', `${window.location.pathname}?proposta=${id}`);
          router.handleRoute();
        }
      };
      
      // Resetar banco
      document.getElementById('h-btn-reset-db').addEventListener('click', () => {
        if (confirm("Deseja realmente limpar todas as propostas e sessões cadastradas para teste?")) {
          db.clear();
        }
      });
    },
    
    updateHomologationPanel() {
      const details = document.getElementById('h-status-details');
      const viewBtn = document.getElementById('h-btn-view-client');
      
      if (state.currentView === 'login') {
        details.innerHTML = `Não Autenticado<br>Tela Atual: Login`;
      } else if (state.currentView === 'comercial') {
        details.innerHTML = `<strong>Autenticado</strong><br>Comercial CNPJ: ${state.session.cnpj}<br>Tela Atual: Painel CRM`;
      } else if (state.currentView === 'cliente') {
        const params = new URLSearchParams(window.location.search);
        const activeId = params.get('proposta');
        const pData = params.get('p_data');
        if (pData) {
          const prop = decodeProposal(pData);
          details.innerHTML = `<strong>Visão do Cliente (URL)</strong><br>Proposta: ${prop ? prop.id : 'Carregando...'}<br>Tela Atual: Visualizador`;
          viewBtn.disabled = false;
          viewBtn.dataset.pData = pData;
          if (prop) viewBtn.dataset.propId = prop.id;
        } else if (activeId) {
          details.innerHTML = `<strong>Visão do Cliente (Local)</strong><br>Proposta: ${activeId}<br>Tela Atual: Visualizador`;
          viewBtn.disabled = false;
          viewBtn.dataset.propId = activeId;
        }
      }
    }
  };

  // ==========================================
  // 4. CANVAS DE ASSINATURA DIGITAL
  // ==========================================
  const signaturePad = {
    canvas: null,
    ctx: null,
    isDrawing: false,
    hasSignature: false,
    
    init() {
      signaturePad.canvas = document.getElementById('signature-pad');
      if (!signaturePad.canvas) return;
      
      signaturePad.ctx = signaturePad.canvas.getContext('2d');
      
      // Eventos de desenho (Mouse)
      signaturePad.canvas.addEventListener('mousedown', signaturePad.startDrawing);
      signaturePad.canvas.addEventListener('mousemove', signaturePad.draw);
      window.addEventListener('mouseup', signaturePad.stopDrawing);
      
      // Eventos de desenho (Touch/Mobile)
      signaturePad.canvas.addEventListener('touchstart', signaturePad.startDrawingMobile);
      signaturePad.canvas.addEventListener('touchmove', signaturePad.drawMobile);
      window.addEventListener('touchend', signaturePad.stopDrawing);
      
      // Botão Limpar
      document.getElementById('btn-clear-signature').addEventListener('click', signaturePad.clear);
      
      // Botão Confirmar Assinatura
      document.getElementById('btn-confirm-signature').addEventListener('click', signaturePad.submitAcceptance);
    },
    
    startDrawing(e) {
      signaturePad.isDrawing = true;
      signaturePad.ctx.beginPath();
      
      // Obter coordenadas relativas
      const rect = signaturePad.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      signaturePad.ctx.moveTo(x, y);
      signaturePad.ctx.lineWidth = 2.5;
      signaturePad.ctx.lineCap = 'round';
      signaturePad.ctx.strokeStyle = '#000000'; // rubrica em preto no papel
    },
    
    draw(e) {
      if (!signaturePad.isDrawing) return;
      
      const rect = signaturePad.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      signaturePad.ctx.lineTo(x, y);
      signaturePad.ctx.stroke();
      signaturePad.hasSignature = true;
    },
    
    startDrawingMobile(e) {
      signaturePad.isDrawing = true;
      signaturePad.ctx.beginPath();
      
      const rect = signaturePad.canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      
      signaturePad.ctx.moveTo(x, y);
      signaturePad.ctx.lineWidth = 2.5;
      signaturePad.ctx.lineCap = 'round';
      signaturePad.ctx.strokeStyle = '#000000';
      
      e.preventDefault(); // Evita scroll ao assinar
    },
    
    drawMobile(e) {
      if (!signaturePad.isDrawing) return;
      
      const rect = signaturePad.canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      
      signaturePad.ctx.lineTo(x, y);
      signaturePad.ctx.stroke();
      signaturePad.hasSignature = true;
      
      e.preventDefault();
    },
    
    stopDrawing() {
      signaturePad.isDrawing = false;
    },
    
    clear() {
      if (!signaturePad.canvas) return;
      signaturePad.ctx.clearRect(0, 0, signaturePad.canvas.width, signaturePad.canvas.height);
      signaturePad.hasSignature = false;
    },
    
    submitAcceptance() {
      const name = document.getElementById('sign-client-name').value.trim();
      const cpf = document.getElementById('sign-client-cpf').value.trim();
      const acceptedCheckbox = document.getElementById('chk-accept-terms').checked;
      
      if (!name) {
        alert("Por favor, preencha o Nome do Assinante.");
        return;
      }
      if (cpf.length !== 14) {
        alert("Por favor, preencha um CPF válido.");
        return;
      }
      if (!signaturePad.hasSignature) {
        alert("Por favor, assine digitalmente na área pontilhada antes de enviar.");
        return;
      }
      if (!acceptedCheckbox) {
        alert("Você precisa declarar o de acordo marcando a caixa de seleção correspondente.");
        return;
      }
      
      // Salvar assinatura
      const params = new URLSearchParams(window.location.search);
      const pData = params.get('p_data');
      const propId = params.get('proposta');
      let prop = null;
      
      if (pData) {
        prop = decodeProposal(pData);
      } else if (propId) {
        prop = db.getProposal(propId);
      }
      
      if (prop) {
        prop.status = "Aceito";
        prop.signatureData = {
          signedAt: new Date().toISOString(),
          signerName: name,
          signerCpf: cpf,
          signatureImg: signaturePad.canvas.toDataURL() // Transforma desenho em imagem base64
        };
        
        db.saveProposal(prop);
        
        // Efeito visual de celebração (Confetti)
        confetti.trigger();
        
        // Recarregar tela do cliente com visual de contrato assinado
        ui.loadClientView(prop);
        
        alert("Proposta aceita e assinada eletronicamente com sucesso! Use o botão de WhatsApp abaixo para enviar o comprovante de assinatura de volta ao comercial.");
      }
    }
  };

  // ==========================================
  // 5. ANIMAÇÃO DE CONFETTI (FEITA EM CANVAS)
  // ==========================================
  const confetti = {
    trigger() {
      // Cria elemento canvas temporário no topo da página
      const canvas = document.createElement('canvas');
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '9999';
      document.body.appendChild(canvas);
      
      const ctx = canvas.getContext('2d');
      let width = canvas.width = window.innerWidth;
      let height = canvas.height = window.innerHeight;
      
      window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
      });
      
      const colors = ['#0088ff', '#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];
      const particles = [];
      
      // Adicionar 150 partículas
      for (let i = 0; i < 150; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height - height, // começa acima da tela
          r: Math.random() * 6 + 4,
          d: Math.random() * 10 + 5, // densidade / velocidade
          color: colors[Math.floor(Math.random() * colors.length)],
          tilt: Math.random() * 10 - 5,
          tiltAngleIncremental: Math.random() * 0.07 + 0.02,
          tiltAngle: 0
        });
      }
      
      let animationFrame;
      let opacity = 1.0;
      
      function draw() {
        ctx.clearRect(0, 0, width, height);
        
        particles.forEach((p, idx) => {
          p.tiltAngle += p.tiltAngleIncremental;
          p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
          p.x += Math.sin(p.tiltAngle);
          p.tilt = Math.sin(p.tiltAngle - idx / 3) * 15;
          
          ctx.beginPath();
          ctx.lineWidth = p.r;
          ctx.strokeStyle = p.color;
          ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
          ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
          ctx.stroke();
        });
        
        // Detectar fim do ciclo das partículas
        let active = false;
        particles.forEach(p => {
          if (p.y < height) active = true;
        });
        
        if (active) {
          animationFrame = requestAnimationFrame(draw);
        } else {
          // Desvanecimento lento do canvas
          canvas.style.transition = 'opacity 1s ease';
          canvas.style.opacity = '0';
          setTimeout(() => {
            document.body.removeChild(canvas);
          }, 1000);
        }
      }
      
      draw();
      
      // Forçar parada após 6 segundos caso trave
      setTimeout(() => {
        cancelAnimationFrame(animationFrame);
        if (canvas.parentNode) {
          document.body.removeChild(canvas);
        }
      }, 6000);
    }
  };

  // Inicializar o aplicativo ao carregar o DOM
  document.addEventListener('DOMContentLoaded', () => {
    db.init();
    ui.init();
    router.init();
  });

})();
