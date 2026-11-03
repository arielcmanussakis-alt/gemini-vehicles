# GEMINI VEHICLES — versão 0.4.0 (protótipo funcional)

## Instalar no Foundry

Em Setup → Add-on Modules → Install Module, cole no campo **Manifest URL**:

```
https://raw.githubusercontent.com/arielcmanussakis-alt/gemini-vehicles/main/module.json
```

Para publicar uma versão nova: suba `version` em `module.json` e o número no link de `download`, gere `dist/gemini-vehicles-vX.Y.Z.zip` com o conteúdo do módulo na raiz (sem `dist/` e `.git/`) e faça o commit no `main`.


Módulo para Foundry VTT **v14**, destinado exclusivamente ao sistema `mythras` (Gemini Force Universe). É uma extensão, não uma alteração no sistema-base.

## Instalação local

1. Encerre o Foundry.
2. Extraia a pasta `gemini-vehicles` diretamente para `FoundryVTT/Data/modules/`.
3. Abra o mundo **Gemini Force (Mythras)** e habilite **Gemini Vehicles | Fichas de Veículos** em **Gerenciar Módulos**.
4. Na aba **Atores**, use **Criar Veículo**. Se o botão não aparecer no seu layout, crie um Macro de Script com:

```js
await game.geminiVehicles.createVehicle("Nome do Veículo");
```

Os veículos são criados como documentos Actor do subtipo `character`, mas identificados pela flag `gemini-vehicles.vehicle.isVehicle` e com a ficha `GeminiVehicleSheet` atribuída. Isso é necessário porque o sistema entregue possui apenas os subtipos `character` e `summon`. **Não escolha esta ficha para um personagem comum**.

## Uso básico

- **Imagem do veículo:** clique na área grande à esquerda, em proporção 9:16 fixa; a imagem do Actor é usada ali. A imagem do token protótipo também é atualizada.
- **Condutor:** arraste um Actor de personagem do diretório para o quadrante do condutor. O módulo armazena o UUID, e não copia a ficha.
- **Testes:** as perícias Condução, Pilotar, Canoagem, Tolerância e Navegação são pesquisadas nos Itens do personagem (`standardSkill`/`professionalSkill`) e seu `totalVal` calculado pelo sistema é lido em tempo real.
- **Rolagens:** os atalhos lançam 1d100 no chat, com graus de dificuldade Mythras, críticos e falhas críticas.
- **Dano:** informe o dano bruto e clique **APLICAR**. Os escudos absorvem primeiro, depois o Casco/PA, depois a Estrutura. Quando há penetração, o módulo rola 1d100 para chance de avaria e seleciona aleatoriamente um Sistema, caso atingido.
- **Sistemas:** edite o nome e o máximo de impactos por componente; adicione ou remova sistemas. Botões + / − aplicam/reparam um impacto. 'Avariado' e 'Inoperante' são indicadores visuais; efeitos específicos de avaria dependem do Mestre.
- **Operações:** testes de controle do condutor; velocidade forçada (+1 passo: 1d6 minutos, 1d12 em crítico; +2 passos: Hercúleo, 1d3 minutos), rolador de perda de controle e contador manual de Pontos de Movimento.
- **Características:** texto livre para Traits, combustível, equipamentos, armamentos, modificações e histórico.

## O que o módulo NÃO automatiza nesta versão

O manual **GEMINI FORCE UNIVERSE RPG — v4**, página 40, define as características e o fluxo de dano, mas **não fornece as tabelas numéricas completas** de Perda de Controle, dano de colisão aos ocupantes, sistema atingido por tipo de veículo, limites de impactos por Tamanho, nem a pontuação de Movimento por grau de sucesso. Por isso, em vez de inventar tabelas:

- **Perda de Controle:** rola o d100 e deixa a interpretação para o Mestre e a tabela adotada na campanha.
- **Colisão e abalroamento:** o Mestre determina o dano; a ferramenta de Dano aplica o resultado com Casco/Estrutura/Sistemas.
- **Perseguições diferenciais:** os dois condutores fazem os testes, mas a comparação, Efeitos Especiais e PM ficam a cargo do Mestre. O contador é manual.
- **Dano de ocupantes, armas de veículo e efeitos de Sistemas:** mantidos na adjudicação do Mestre até que as tabelas oficiais/adaptadas sejam fornecidas.

Assim, a **v0.4.0 é um protótipo de testes**, não uma implementação verificada e exaustiva de todas as regras de todos os suplementos de Mythras.

## Compatibilidade

O arquivo `system.json` dentro do RAR enviado pelo usuário identifica o sistema **Gemini Force (Mythras) v1.4**, com compatibilidade mínima 11 e verificação 12. Embora este módulo use a API v14 (`ActorSheetV2` e `DocumentSheetConfig.registerSheet`), **não foi possível executar o Foundry para testar o sistema-base v1.4 em v14**. Caso o sistema-base apresente incompatibilidades, o módulo não consegue corrigi-las sozinho.

## Estrutura de dados

Propriedades exclusivas de veículo ficam em `flags.gemini-vehicles.vehicle`; não há mudanças em `template.json`, nem na classe de Actor, nem nos templates de personagem do sistema-base.

Para backup: exporte normalmente o Actor do veículo. Para replicar: duplique o Actor.

### Testes locais executados

`node tests/test-rules.mjs` valida cálculos de dano, detecção do item de perícia, escala de dificuldade, graus de sucesso, velocidade e cópia dos registros. `node --check scripts/main.mjs` verifica a sintaxe. Esses testes **não substituem um teste integrado no Foundry**.

## Layout 0.4.0

Ficha compacta com proporções, tipografia, cartões arredondados e rolagens roxas baseadas no Gemini Mythras enviado. Token persistente à esquerda (9:16), condutor à direita e três abas funcionais. Não requer imagens externas.

## Ajustes 0.4.0

- Retrato do veículo fixo à esquerda, proporção **9:16** durante todas as abas.
- Apenas três atributos principais: **Estrutura, Casco, Escudos**.
- Abaixo deles, Tamanho, Velocidade e Manuseio; esses três seletores são editáveis somente pelo Mestre.
- Dano rápido dentro do cartão Estrutura; o valor informado é dano **bruto** e segue **Escudos → Casco → Estrutura**.
- Navegação resumida a **Operação, Sistemas e Detalhes**, sem aba de configurações. Eventos de clique são vinculados diretamente na renderização (correção das abas anteriores).
- Retrato do condutor ocupa o quadrante inteiro (recorte `object-fit: cover`), com ícones de abrir ficha e remover vínculo, no canto superior direito.
- Arraste um ator de tipo personagem sobre a imagem de condutor para vincular por UUID.

### Limitações verificáveis

A validação automática cobre sintaxe, arquivos e lógica numérica. **Não foi possível iniciar um mundo Foundry VTT v14 real nesta máquina**, então clique/drag-and-drop devem ser confirmados in-game antes da homologação. A configuração de Velocidade e Manuseio é restrita a usuários GM; dados e reparos requerem permissão de proprietário do Actor.

## Ajustes v0.4.0

- Nome do veículo sempre branco, sem a linha "GEMINI FORCE / VEÍCULOS".
- Estrutura, Casco e Escudo com títulos centralizados.
- Perícias do condutor, inclusive Tolerância, delegam primeiro ao `driver.sheet.roller.rollSkill(item)` original do Mythras: seis níveis de dificuldade, modificadores situacionais e cores nativas. Há fallback para fichas que não oferecem `roller`.
- Lógica de dificuldades e cores no fallback foi alinhada com o `main.bundle.js` do Mythras fornecido (2× / 1,5× / 1× / 2/3× / 1/2× / 1/10×), usando `systems/mythras/templates/chat/skill-roll.hbs`.
- Cada Sistema avariado aparece como ícone minimalista pulsante sobre o retrato fixo do veículo. Um Sistema inoperante fica estático e em tons de cinza; o ícone desaparece quando reparado. Ícones não afetam o token.
- Abas selecionadas recebem contorno interno da cor do tema, sem borda vermelha cortada.
- Tema do condutor herdado de `driver.system.gemini.theme`, com variáveis de paleta, classe `theme-<code>` e recursos de mídia quando disponibilizados pelo Gemini; atualiza com o Actor vinculado. Ao remover o condutor, volta ao tema padrão.

**Observação:** temas especiais da Gemini Store dependem de CSS e mídia carregados pelo próprio sistema. O módulo tenta ativar o tema através do `getData()` da ficha original quando o tema ainda não estiver em cache. Temas cujo CSS altera seletores exclusivos da ficha de personagem podem exigir adaptação específica para os componentes do veículo.
