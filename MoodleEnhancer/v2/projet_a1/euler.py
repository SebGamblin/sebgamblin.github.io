
import matplotlib.pyplot as plt
import numpy as np

"""
Résolution d'Euler pour une fonction exponentielle
"""

interval_begin = 0
interval_end = 2
nb_step = 10

pas = (interval_end - interval_begin) / nb_step

a = 2

for nb_step in [5, 10, 14, 18, 20]:

    # list of time steps
    #X = [(interval_begin + i * pas) for i in range(interval_end * nb_step + 1)]
    X = np.linspace(interval_begin, interval_end, nb_step)
    # begin calculation of Ys with 1, needed to be extended
    Y = [a]

    for i in range(1,len(X)):
        yn = Y[i-1]*(a*pas+1)
        Y.append(yn)

    print(X)
    print(Y)

    plt.plot(X, Y, label=f"a={a}, N={nb_step}")

plt.legend()
plt.show()