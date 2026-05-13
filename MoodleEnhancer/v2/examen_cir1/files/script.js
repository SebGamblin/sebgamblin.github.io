/**************************************************
 * INITIALISATION
 **************************************************/

const taskInput = document.getElementById("taskInput");
const addBtn = document.getElementById("addBtn");
const clearBtn = document.getElementById("clearBtn");
const taskList = document.getElementById("taskList");
const taskCount = document.getElementById("taskCount");
const doneCount = document.getElementById("doneCount");

// Tableau des tâches (texte uniquement)
let tasks = [];


/**************************************************
 * FONCTIONS
 **************************************************/

/**
 * Met à jour les compteurs
 */
function updateCounters() {
    taskCount.innerText = tasks.length;

    const doneTasks = taskList.querySelectorAll("li.done");
    doneCount.innerText = doneTasks.length;
}


/**
 * Crée un élément <li> représentant une tâche
 */
function createTaskElement(text) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.innerText = text;

    const deleteBtn = document.createElement("button");
    deleteBtn.innerText = "❌";
    deleteBtn.style.marginLeft = "10px";

    // Clic sur la tâche : terminée / non terminée
    li.addEventListener("click", () => {
        li.classList.toggle("done");
        updateCounters();
    });

    // Clic sur le bouton : suppression de la tâche
    deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation(); // empêche le toggle "done"
        li.remove();

        // Retirer la tâche du tableau
        tasks = tasks.filter(task => task !== text);
        updateCounters();
    });
    li.appendChild(deleteBtn);
    li.appendChild(span);
    

    return li;
}



/**
 * Ajoute une tâche
 */
function addTask() {
    const text = taskInput.value.trim();

    if (text === "") {
        return;
    }

    tasks.push(text);

    const li = createTaskElement(text);
    taskList.appendChild(li);

    taskInput.value = "";
    updateCounters();
}


/**
 * Supprime toutes les tâches
 */
function clearTasks() {
    tasks = [];
    taskList.innerHTML = "";
    updateCounters();
}


function showLabel(elementId, description, position = "top") {
    const el = document.getElementById(elementId);
    if (!el) return;

    const rect = el.getBoundingClientRect();

    const label = document.createElement("div");
    label.className = "ui-label";

    label.innerHTML = `
        <span class="label-id">#${elementId}</span>
        <span class="label-text">${description}</span>
    `;

    if (position === "bottom") {
        label.classList.add("bottom");
        label.style.top = `${rect.bottom + window.scrollY + 8}px`;
    } else {
        label.style.top = `${rect.top + window.scrollY}px`;
    }

    label.style.left = `${rect.left + rect.width / 2}px`;

    document.body.appendChild(label);
}




showLabel("taskInput", "Champ de saisie d’une tâche");
showLabel("addBtn", "Bouton d’ajout d’une tâche");
showLabel("clearBtn", "Suppression de toutes les tâches", "bottom");
showLabel("taskList", "Liste contenant les tâches");
showLabel("taskCount", "Nombre total de tâches");
showLabel("doneCount", "Nombre de tâches terminées");



/**************************************************
 * ÉVÉNEMENTS
 **************************************************/

addBtn.addEventListener("click", addTask);

clearBtn.addEventListener("click", clearTasks);

taskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        addTask();
    }
});

// Initialisation affichage
updateCounters();