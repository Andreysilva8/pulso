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

## Aplicativo para Windows

O pacote `desktop/` cria um aplicativo Windows separado que abre a versão publicada do Pulso em um Electron protegido. Ele oferece seletor próprio de tela/janela, áudio do computador com consentimento explícito, evita reduzir a atividade quando a janela é minimizada e começa em 1080p/60 fps. A última qualidade escolhida também fica salva.

```bash
npm run desktop:install
npm run desktop:smoke
npm run desktop:make
```

O instalador é gerado em `release/Pulso-Desktop-Setup-0.2.0.exe`. Ele ainda não possui assinatura de código, então versões de teste podem exibir um aviso do Windows SmartScreen.

O aplicativo melhora o controle da captura e a estabilidade no Windows, mas 60 fps continua sendo um alvo: CPU, upload, quantidade de espectadores e o caminho de rede definem a taxa efetiva. O banner da transmissão mostra o FPS realmente codificado e o bitrate total. Se surgir `Compatível · limite 30 fps`, a conexão direta falhou; configure o TURN temporário para recuperar o caminho WebRTC.

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

## Cloudflare Workers

A migração para Cloudflare está pronta em `cloudflare/` e `wrangler.jsonc`. O Worker entrega o build React com Static Assets e encaminha `/ws` para um Durable Object por workspace. O objeto usa WebSocket Hibernation, guarda o estado de cada conexão em attachments e persiste as últimas 100 mensagens por canal no storage SQLite.

O protocolo do frontend não muda: `/ws` usa o workspace definido em `DEFAULT_WORKSPACE_ID`, inicialmente `pulso-publico`. Como o MVP ainda não possui autenticação, outro valor em `?workspace=` é rejeitado antes de criar um Durable Object; isso impede que visitantes anônimos consumam storage criando workspaces arbitrários. Presença, chat, chamadas, offers/answers, ICE e o fallback reduzido mantêm os mesmos eventos do servidor Node.

O primeiro deploy pode ser feito sem TURN e usa apenas STUN/WebRTC direto. Para habilitar depois o Cloudflare Realtime TURN, cadastre as credenciais como secrets; elas nunca entram no bundle nem são enviadas ao navegador:

```bash
npx wrangler secret put CLOUDFLARE_TURN_KEY_ID
npx wrangler secret put CLOUDFLARE_TURN_API_TOKEN
```

Depois valide e publique:

```bash
npm run cloudflare:test
npm run cloudflare:typecheck
npm run cloudflare:check
npm run cloudflare:smoke
npm run cloudflare:deploy
```

Para desenvolvimento local, use `npm run cloudflare:dev`. O TTL padrão do TURN é 3.600 segundos; durante uma chamada, o heartbeat JSON que o cliente já envia renova a credencial aos 75% do TTL sem manter o Durable Object acordado com timers.

O caminho de 1080p/60 fps continua sendo a trilha WebRTC direta ou assistida por TURN. O Worker não transforma quadros base64 em vídeo: o fallback continua intencionalmente limitado a 854×480 e até 30 fps, com descarte sob congestionamento. Isso protege a fluidez, a franquia gratuita e o limite diário de mensagens do Durable Object.

## O que está implementado

- canais de texto com histórico em memória e indicador de digitação;
- presença online e perfil local editável;
- salas de voz com múltiplos participantes em malha P2P;
- áudio, vídeo, mute e câmera on/off;
- compartilhamento de tela com perfis selecionáveis de 480p, 720p ou 1080p e 15, 30 ou 60 fps; o padrão é 1080p/60 fps, com bitrate adaptado à quantidade de espectadores;
- aplicativo Windows com perfil inicial 1080p/60, seletor explícito de tela/janela e áudio loopback protegido;
- telemetria durante a transmissão com FPS realmente codificado por espectador e bitrate total enviado;
- detecção de falha real da trilha WebRTC sem confundir uma tela estática com congelamento, e modo compatível adaptativo de tela/áudio em até 854×480/30 fps, ativado sob demanda somente para o espectador afetado;
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

Cloudflare Workers (opção de produção)
├── Static Assets para o build React
├── Worker para origem, health e roteamento por workspace
├── Durable Object com WebSocket Hibernation
├── SQLite para histórico curto de chat
└── Cloudflare Realtime TURN opcional, com credenciais temporárias
```

## Limites do MVP e produção

- Câmera, microfone e tela exigem `localhost` ou HTTPS. Para testar em outro computador da rede, publique atrás de HTTPS.
- O histórico e as salas ficam em memória e são apagados quando o servidor reinicia. Use um banco de dados para persistência.
- Não há autenticação. Antes de publicar, adicione contas, autorização por comunidade e proteção contra abuso.
- A receita OCI ativa uma senha HTTP no Caddy para não deixar esta demo aberta enquanto contas ainda não existem.
- A chamada usa malha P2P, ideal para aproximadamente 2–4 pessoas. Salas maiores devem usar um SFU, como LiveKit, mediasoup ou Janus.
- O STUN padrão não atravessa todas as redes. Em produção, configure `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` somente no servidor; o Pulso gera credenciais temporárias e as entrega apenas ao participante depois que ele entra em uma chamada. `VITE_ICE_SERVERS` fica disponível apenas para ambientes de teste ou outro provedor compatível.
- Quando o vídeo direto ainda não entregou quadros, o modo compatível usa até 854×480 e tenta até 30 fps com quadros menores e descarte sob congestionamento. Ele evita a tela presa em “Conectando”, mas a cópia reduzida passa pelo servidor e não substitui TURN/SFU em produção.
- Em Chrome 141 ou posterior, “Tela inteira” pode transmitir áudio com `restrictOwnAudio`; marque “Compartilhar áudio”. Em navegadores que não confirmam essa proteção, o Pulso mantém o vídeo mas bloqueia o áudio do sistema para impedir retorno infinito.
- A integração segura com Cloudflare Realtime TURN acompanha o repositório; o relay TURN é um serviço externo e precisa das duas variáveis secretas no Render.
- No deploy Cloudflare, as mesmas credenciais são cadastradas com `wrangler secret put`. Static Assets é gratuito e ilimitado, mas Workers, Durable Objects e Realtime têm franquias; ultrapassar esses limites não faz 1080p/60 virar um relay WebSocket viável.
- Durable Objects usam localização stateful própria. O hint `sam` já está configurado, mas é apenas uma preferência da plataforma e não uma garantia de que o objeto da sala execute fisicamente no Brasil. A mídia WebRTC direta não passa pelo Durable Object.

## Scripts

- `npm run dev` — interface e signaling com recarga automática;
- `npm run build` — checagem TypeScript e build otimizado;
- `npm start` — servidor de produção na porta 4173;
- `npm test` — testes unitários e de tempo real;
- `npm run test:realtime` — somente o smoke test WebSocket.
- `npm run cloudflare:test` — testes locais do router e do Durable Object;
- `npm run cloudflare:typecheck` — verifica os tipos específicos do runtime Workers;
- `npm run cloudflare:check` — build e empacotamento Wrangler sem publicar;
- `npm run cloudflare:smoke` — inicia o runtime local real e valida assets, origem, chat, signaling e fallback;
- `npm run cloudflare:dev` — build e ambiente Cloudflare local;
- `npm run cloudflare:deploy` — build e publicação no Workers;
- `npm run desktop:smoke` — valida o aplicativo contra a publicação do Render;
- `npm run desktop:make` — testa e gera o instalador do Windows.
