# Pulso

**Pulso** é um MVP de comunidade em tempo real inspirado na dinâmica de apps como o Discord, mas com identidade própria. Ele inclui canais de texto, presença online, chamadas WebRTC com câmera e microfone, chat dentro da chamada e compartilhamento de tela.

## Rodar localmente

Requisitos recomendados: Node.js 24 LTS e npm 11.

```bash
npm install
npm run dev
```

Abra `http://localhost:5173` em duas abas para testar uma chamada real entre dois participantes. O modo de desenvolvimento inicia a interface e o servidor de sinalização juntos.

Para testar o build de produção:

```bash
npm run build
npm start
```

Depois abra `http://localhost:4173`.

O servidor de produção usa `HOST=127.0.0.1` por padrão. Em container, defina `HOST=0.0.0.0` e publique a porta somente no loopback do host, atrás de HTTPS.

## Publicação temporária por 10 horas

Para gerar um endereço HTTPS público sem criar conta em um provedor:

```powershell
.\scripts\publicar-10h.ps1 -Hours 10
```

O script inicia um Quick Tunnel da Cloudflare, mantém o Windows acordado e encerra o túnel automaticamente ao final. O computador e a internet precisam permanecer ligados. O endereço é temporário, muda a cada execução e não tem garantia de disponibilidade.

Para encerrar antes do prazo:

```powershell
.\scripts\parar-publicacao.ps1
```

## Oracle Cloud Always Free

Há uma pilha Terraform pronta para uma VM ARM, rede restrita, Docker, Caddy e HTTPS em [`infra/oci-free`](./infra/oci-free/README.md). O pacote `infra/pulso-oci-free-stack.zip` pode ser enviado diretamente ao OCI Resource Manager.

Ela usa por padrão 1 OCPU, 6 GB de RAM e boot de 50 GB. A aplicação fica protegida por senha no Caddy e a porta 4173 não é exposta à internet. A criação dos recursos depende dos OCIDs, da home region, do seu IPv4 administrativo e da chave pública SSH da conta OCI.

## O que está implementado

- canais de texto com histórico em memória e indicador de digitação;
- presença online e perfil local editável;
- salas de voz com múltiplos participantes em malha P2P;
- áudio, vídeo, mute e câmera on/off;
- compartilhamento de tela com perfis selecionáveis de 480p, 720p ou 1080p e 15, 30 ou 60 fps; o padrão é 720p/30 fps para reduzir travamentos, com bitrate adaptado à quantidade de espectadores;
- detecção de falha real da trilha WebRTC sem confundir uma tela estática com congelamento, e modo compatível de tela/áudio em até 960×540/12 fps, ativado sob demanda somente para o espectador afetado;
- áudio de aba, janela e tela inteira quando o navegador confirma o filtro antieco; áudio de sistema sem esse filtro é bloqueado antes de chegar ao WebRTC/relay;
- câmera desligada por padrão, adquirida somente após clique explícito e completamente liberada ao desligar;
- seleção e troca de microfone durante a chamada, sem desconectar o participante;
- menu de clique direito por participante com mudo local e controles independentes para voz e áudio da transmissão; o atalho visual de volume desaparece após 2,5 segundos sem interação;
- chat separado dentro de cada chamada;
- convites por URL (`?room=cafe`, por exemplo);
- negociação WebRTC com offers simultâneas protegidas;
- reconexão automática do WebSocket;
- estados de permissão e entrada sem mídia;
- interface responsiva para desktop, tablet e celular;
- navegação por teclado, foco visível e redução de movimento.

## Testes

```bash
npm test
```

O comando executa testes unitários e um smoke test com dois clientes WebSocket. Ele valida presença, envio de chat, entrada em chamada, encaminhamento de sinais WebRTC e o relay compatível de tela/áudio.

## Arquitetura

```text
React + TypeScript + Vite
├── interface e estado da comunidade
├── MediaManager (câmera, microfone e tela)
├── PeerManager (RTCPeerConnection por participante)
└── WebSocket (presença, chat, signaling e fallback de mídia)

Node.js + Express + ws
├── entrega do build estático
├── histórico de mensagens em memória
├── presença e salas ativas
├── relay de offers, answers e ICE candidates
└── fallback temporário de quadros da tela e áudio PCM
```

## Limites do MVP e produção

- Câmera, microfone e tela exigem `localhost` ou HTTPS. Para testar em outro computador da rede, publique atrás de HTTPS.
- O histórico e as salas ficam em memória e são apagados quando o servidor reinicia. Use um banco de dados para persistência.
- Não há autenticação. Antes de publicar, adicione contas, autorização por comunidade e proteção contra abuso.
- A receita OCI ativa uma senha HTTP no Caddy para não deixar esta demo aberta enquanto contas ainda não existem.
- A chamada usa malha P2P, ideal para aproximadamente 2–4 pessoas. Salas maiores devem usar um SFU, como LiveKit, mediasoup ou Janus.
- O STUN padrão não atravessa todas as redes. Produção precisa de TURN com credenciais temporárias. Copie `.env.example` para `.env` e configure `VITE_ICE_SERVERS`.
- Quando o vídeo direto ainda não entregou quadros, o modo compatível usa até 960×540 a no máximo 12 fps. Ele evita a tela presa em “Conectando”, mas a cópia reduzida passa pelo servidor e não substitui TURN/SFU em produção.
- Em Chrome 141 ou posterior, “Tela inteira” pode transmitir áudio com `restrictOwnAudio`; marque “Compartilhar áudio”. Em navegadores que não confirmam essa proteção, o Pulso mantém o vídeo mas bloqueia o áudio do sistema para impedir retorno infinito.
- O servidor TURN não acompanha este repositório.

## Scripts

- `npm run dev` — interface e signaling com recarga automática;
- `npm run build` — checagem TypeScript e build otimizado;
- `npm start` — servidor de produção na porta 4173;
- `npm test` — testes unitários e de tempo real;
- `npm run test:realtime` — somente o smoke test WebSocket.
