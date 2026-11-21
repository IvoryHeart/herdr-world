import { feature_testing_probe } from "../index.gen";

const element = feature_testing_probe.mount();
document.body.textContent = `${element.type}:${element.props.children}`;
