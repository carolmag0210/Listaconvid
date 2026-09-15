# Lista de Convidados e Controle de Entrada — Luciene Vilela

Página criada para consulta de convidados confirmados e controle de entrada da celebração de **Luciene Vilela**.

**Evento:** 26 de setembro de 2026, às 20h  
**Local:** Clube Espanhol — Salvador/BA

---

## Objetivo

A página foi criada para uso da:

- recepção;
- segurança;
- organização;
- cliente responsável pelo evento.

Ela permite consultar e controlar os convidados sem dar acesso direto à planilha.

---

## Estrutura do sistema

```text
Recepção / Segurança
        ↓
Página da lista
        ↓
Google Apps Script
        ↓
Google Sheets
```

A planilha pode permanecer privada e acessível apenas ao responsável pelo evento.

---

## Estrutura do projeto no GitHub

Exemplo:

```text
/
├── index.html
├── styles.css
├── app.js
├── config.js
├── README.md
└── assets/
    ├── LV_DOURADO.png
    ├── trevo-lista.png
    └── demais imagens
```

O Apps Script não deve ser enviado ao GitHub.

---

## Funcionalidades

A página possui:

- lista alfabética;
- busca por nome;
- filtro `Todos`;
- filtro `Aguardando`;
- filtro `Já entraram`;
- total de confirmados;
- total de pessoas que já entraram;
- total aguardando;
- check-in individual;
- horário de entrada;
- desfazer entrada;
- atualização automática;
- atualização manual;
- uso em vários aparelhos;
- persistência dos dados;
- layout responsivo.

---

## Relação alfabética

Todos os nomes aparecem individualmente.

Exemplo:

Confirmação:

```text
Gabrielle Coelho
Acompanhante: Flávia Paiva
```

Na lista:

```text
Flávia Paiva
Gabrielle Coelho
```

A lista é ordenada alfabeticamente.

---

## Busca

A busca funciona por parte do nome.

Exemplo:

```text
gabr
```

encontra:

```text
Gabrielle Coelho
```

Isso facilita o uso na portaria.

---

## Check-in

Ao clicar em:

```text
Liberar entrada
```

a interface muda imediatamente para:

```text
✓ Já entrou
```

O salvamento acontece em segundo plano.

Isso evita deixar a recepção esperando visualmente por alguns segundos.

---

## Persistência

O status de entrada é salvo na planilha.

Portanto:

- atualizar a página não apaga;
- fechar a página não apaga;
- abrir depois não apaga;
- trocar de aparelho não apaga;
- outro segurança vê o mesmo status.

---

## Desfazer entrada

Caso alguém seja marcado por engano, a página mostra:

```text
✓ Já entrou    ↶ Desfazer entrada
```

O botão de desfazer utiliza um tom vermelho claro/quase rosa.

Ao clicar, o sistema pede confirmação antes de cancelar o check-in.

---

## Sincronização

Durante o carregamento inicial, o ideal é exibir:

```text
Sincronizando…
```

em vez de mostrar números zerados.

A leitura segue o fluxo:

```text
Página
→ Apps Script
→ Google Sheets
→ Apps Script
→ Página
```

Por isso, parte da latência depende do Google Apps Script e do Google Sheets.

---

## Atualização automática

A página atualiza periodicamente os dados.

Isso permite que vários aparelhos acompanhem:

- novos check-ins;
- entradas desfeitas;
- alterações recentes.

Também existe o botão:

```text
Atualizar
```

para forçar uma nova sincronização.

---

## Aba Controle de Entrada

O Apps Script cria e mantém a aba:

```text
Controle de Entrada
```

Estrutura lógica:

| Campo | Função |
|---|---|
| ID | Identificador interno |
| Nome | Nome individual |
| Vínculo/Grupo | Convidado principal relacionado |
| Tipo | Principal ou acompanhante |
| Entrou | Status |
| Horário de entrada | Horário |
| Atualizado em | Última alteração |

Para convidados principais, `Vínculo/Grupo` fica vazio.

Para acompanhantes, aparece o convidado principal relacionado.

---

## Planilha privada

A planilha não precisa ser compartilhada com:

- segurança;
- recepção;
- convidados.

Essas pessoas usam apenas a página.

Isso evita alterações acidentais em:

- nomes;
- fórmulas;
- colunas;
- dashboard;
- controle de entrada.

---

## Identidade visual

A página segue o mesmo visual do convite:

- branco/champagne;
- dourado;
- logo LV;
- cards suaves;
- círculos animados;
- trevo;
- tipografia elegante;
- status verde para quem entrou;
- botão rosa/vermelho claro para desfazer.

---

## Trevo

O trevo aparece de forma discreta ao lado do cabeçalho:

```text
Relação alfabética
```

Arquivo:

```text
assets/trevo-lista.png
```

---

## Animação dos círculos

A bolinha deve permanecer sobre a linha da órbita.

A animação correta é:

```css
@keyframes orbitGlow {
  from {
    transform: rotate(0deg) translateX(var(--orbit-radius));
  }

  to {
    transform: rotate(360deg) translateX(var(--orbit-radius));
  }
}
```

---

## config.js

Exemplo:

```javascript
window.PORTARIA_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyJou8QsnvKEPTyq4AJmAIk_Bog7hGOnUxEMvdouUwk_oL-mF7u4kLIWV7Xh9zaLJO0aw/exec",
  EVENT_NAME: "Luciene Vilela",
  AUTO_REFRESH_MS: 30000
};
```

---

## Publicação no GitHub Pages

Criar um repositório, por exemplo:

```text
lista-convidados-luciene
```

Depois:

1. enviar os arquivos;
2. abrir `Settings`;
3. abrir `Pages`;
4. selecionar `Deploy from a branch`;
5. branch: `main`;
6. pasta: `/ (root)`;
7. salvar.

---

## Limpeza dos testes

Antes do evento:

1. abrir a aba principal;
2. apagar os dados de teste das colunas A:D;
3. não apagar cabeçalhos;
4. executar no Apps Script:

```javascript
testarPortaria()
```

5. atualizar a página.

---

## Lista impressa como backup

Mesmo com a página digital, é recomendável ter uma lista impressa em ordem alfabética.

Ela serve como contingência em caso de:

- internet ruim;
- bateria;
- aparelho indisponível;
- preferência da equipe por papel.

---

## QR Code

Foi considerada a possibilidade de QR Code individual.

A solução é tecnicamente possível, mas ficou fora do escopo atual porque:

- aumenta a complexidade;
- exige distribuição dos códigos;
- pode dificultar o uso por idosos ou pessoas pouco familiarizadas com celular;
- a busca por nome já atende bem este evento.

---

## Recomendações para o dia do evento

Antes da abertura:

1. testar a página no celular;
2. testar em outro aparelho;
3. testar busca;
4. testar check-in;
5. testar desfazer entrada;
6. confirmar horário;
7. confirmar atualização entre aparelhos;
8. imprimir lista de backup;
9. manter a planilha privada.

---

## Observação

A página foi pensada para a recepção operar sem precisar conhecer Google Sheets ou Apps Script.

A equipe usa apenas a interface da lista.
