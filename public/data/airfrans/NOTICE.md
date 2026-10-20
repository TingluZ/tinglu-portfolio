# Data notice

This folder is a derivative of the AirfRANS dataset (Bonnet et al., NeurIPS 2022
Datasets and Benchmarks Track): https://github.com/Extrality/AirfRANS

Fields from the 200 `full` test simulations are cropped to a window around the
airfoil, downsampled, and stored at reduced precision alongside FNO and GNN
predictions made with https://github.com/TingluZ/airfrans-fno-gnn.

Like the original, this data is licensed under the Open Database License
(ODbL) v1.0: https://opendatacommons.org/licenses/odbl/1-0/

If you use it, please cite the original dataset:

```bibtex
@inproceedings{bonnet2022airfrans,
  title={AirfRANS: High Fidelity Computational Fluid Dynamics Dataset for Approximating Reynolds-Averaged Navier-Stokes Solutions},
  author={Florent Bonnet and Jocelyn Ahmed Mazari and Paola Cinnella and Patrick Gallinari},
  booktitle={Thirty-sixth Conference on Neural Information Processing Systems Datasets and Benchmarks Track},
  year={2022},
  url={https://arxiv.org/abs/2212.07564}
}
```
