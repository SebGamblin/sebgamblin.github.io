---
title: "Introduction à Python"
subtitle: "CBIO1 — 2024-2025"
author: "John DOE"
type: cours
---

# Introduction à Python

Sous-titre — CBIO1

---

## Pourquoi Python ?

Python est un langage de programmation **interprété**, **dynamiquement typé** et
conçu pour la lisibilité du code.

> "Code is read more often than it is written." — Guido van Rossum

<div class="callout callout-info">
Python est le langage le plus utilisé en data science, IA et automatisation.
</div>

---

## Variables et types

```python
# Types de base
x      = 42          # int    [hl]
pi     = 3.14        # float
nom    = "Alice"     # str
actif  = True        # bool
rien   = None        # NoneType

print(type(x))       # <class 'int'>
```

| Type    | Exemple      | Mutable |
|---------|-------------|---------|
| `int`   | `42`        | Non     |
| `float` | `3.14`      | Non     |
| `str`   | `"hello"`   | Non     |
| `list`  | `[1, 2, 3]` | **Oui** |
| `dict`  | `{"a": 1}`  | **Oui** |



> Callout test
> bla  
> bla


[[Internal link|Wikilinks]]

<img src="logo.png"/>


![[log.png]]


> [!info] Here's a callout title
> Here's a callout block.
> It supports **Markdown**


> [!question] Can callouts be nested? 
> [[Internal link|Wikilinks]]
> > [!todo] Yes!, they can.
> > > [!example]  You can even use multiple layers of nesting.


```mermaid
graph TD
    A[Début] --> B{Condition}
    B -->|Oui| C[Résultat]
    B -->|Non| D[Autre]
```

---

## Callouts


<div class="callout callout-info">Info utile.</div>

<blockquote class="callout callout-warning">
    <p>Attention au piège</p>
</blockquote>


<div class="callout callout-warning">
Info utile.
</div>

---

## Formules

Complexité linéaire : $O(n)$

Formule de la somme :

$$S_n = \sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$

---

## Diagramme de flux

<div class="mermaid" style="width:70%;margin:auto">
flowchart TD
    A[Entrée utilisateur] --> B{Valide ?}
    B -->|Oui| C[Traitement]
    B -->|Non| D[Message d'erreur]
    C --> E[Affichage résultat]
    D --> A
</div>

---

## Exercice

<div class="callout callout-warning">
Écrire une fonction `fibonacci(n)` qui retourne le n-ième terme.
</div>

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# Test
for i in range(10):
    print(fibonacci(i), end=' ')
# 0 1 1 2 3 5 8 13 21 34
```

<div class="callout callout-success">
Complexité : $O(2^n)$ récursif → optimisable en $O(n)$ avec la mémoïsation.
</div>
